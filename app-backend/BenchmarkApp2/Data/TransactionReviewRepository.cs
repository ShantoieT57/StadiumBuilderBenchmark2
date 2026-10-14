using Dapper;
using Npgsql;

namespace BenchmarkApp2.Data;

/// <summary>How a request to approve or reject a transaction turned out.</summary>
public enum ReviewOutcome
{
    /// <summary>The transaction was Imported and now has the requested status.</summary>
    Changed,

    /// <summary>No transaction has the id, or its file has been cancelled.</summary>
    NotFound,

    /// <summary>The transaction is already Approved or Rejected, which are final; nothing was changed (TS-02, TS-03).</summary>
    AlreadyReviewed,
}

/// <summary>
/// The outcome of approving or rejecting a transaction, with the transaction's details as they are
/// after the request: changed, or as someone else left them. The details are null only when the
/// transaction was not found.
/// </summary>
public sealed record ReviewResult(ReviewOutcome Outcome, TransactionDetailsRow? Transaction = null);

/// <summary>
/// Database access for approving and rejecting transactions (AP-02..AP-04, RJ-03..RJ-05). Each
/// request is one database transaction.
/// </summary>
/// <remarks>
/// <para>
/// Only an Imported transaction is changed: the update itself requires the status to be Imported.
/// Two requests acting on the same transaction at the same moment therefore change it once. The
/// second waits for the first's row lock and, once the first commits, finds the transaction no
/// longer Imported and changes nothing (PostgreSQL re-checks the condition against the committed
/// row).
/// </para>
/// <para>
/// The file row is locked <c>FOR SHARE</c> before the transaction is changed and stays locked until
/// commit. This conflicts with the <c>FOR NO KEY UPDATE</c> lock that cancelling a file holds (see
/// <see cref="FileCancellationRepository"/>), so an approval and a cancel of the same file never
/// overlap: a cancel that comes second sees the approval and is refused (FX-02), and an approval
/// that comes second finds the file cancelled and its transactions gone. Approvals of different
/// transactions of one file do not wait for each other, since <c>FOR SHARE</c> locks are shared.
/// </para>
/// </remarks>
public sealed class TransactionReviewRepository(NpgsqlDataSource dataSource)
{
    public Task<ReviewResult> ApproveAsync(Guid transactionId, string approvedBy, DateTimeOffset now, CancellationToken cancellationToken) =>
        ReviewAsync(transactionId, TransactionStatusValue.Approved, rejectionReason: null, approvedBy, now, cancellationToken);

    /// <param name="reason">The reason, already checked and trimmed by the caller.</param>
    public Task<ReviewResult> RejectAsync(Guid transactionId, string reason, string rejectedBy, DateTimeOffset now, CancellationToken cancellationToken) =>
        ReviewAsync(transactionId, TransactionStatusValue.Rejected, reason, rejectedBy, now, cancellationToken);

    private async Task<ReviewResult> ReviewAsync(
        Guid transactionId, string status, string? rejectionReason, string changedBy, DateTimeOffset now, CancellationToken cancellationToken)
    {
        // A transaction never moves to another file, so its file can be read before the file is locked.
        const string lockFileSql = """
            SELECT f.cancelled_at IS NULL
            FROM files f
            WHERE f.id = (SELECT t.file_id FROM transactions t WHERE t.id = @transactionId)
            FOR SHARE OF f
            """;
        const string reviewSql = $"""
            UPDATE transactions
            SET status = @status,
                rejection_reason = @rejectionReason,
                last_changed_by = @changedBy,
                last_changed_at = @now
            WHERE id = @transactionId AND status = '{TransactionStatusValue.Imported}'
            """;

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);

        var isFileActive = await connection.QuerySingleOrDefaultAsync<bool?>(
            new CommandDefinition(lockFileSql, new { transactionId }, transaction, cancellationToken: cancellationToken));
        if (isFileActive is not true)
        {
            return new ReviewResult(ReviewOutcome.NotFound);
        }

        var changed = await connection.ExecuteAsync(new CommandDefinition(
            reviewSql, new { transactionId, status, rejectionReason, changedBy, now }, transaction, cancellationToken: cancellationToken));

        // Read in the same database transaction, while the file is still locked, so the details are
        // exactly those the change left (or found), and a cancel cannot remove them in between.
        var details = await TransactionRepository.GetAsync(connection, transaction, transactionId, cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        if (details is null)
        {
            return new ReviewResult(ReviewOutcome.NotFound);
        }
        return new ReviewResult(changed == 1 ? ReviewOutcome.Changed : ReviewOutcome.AlreadyReviewed, details);
    }
}
