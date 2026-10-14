using Dapper;
using Npgsql;

namespace BenchmarkApp2.Data;

/// <summary>A file as it is received, before it is processed.</summary>
public sealed record NewFileRecord(
    string FileName,
    string Kind,
    byte[] Content,
    byte[] ContentSha256,
    Guid UploadedBy,
    DateTimeOffset UploadedAt);

/// <summary>The values stored in <c>files.status</c>.</summary>
public static class FileStatusValue
{
    public const string Uploaded = "Uploaded";
}

/// <summary>Database access for the files table.</summary>
public sealed class FileRepository(NpgsqlDataSource dataSource)
{
    /// <summary>Stores a received file with the status Uploaded and returns its id.</summary>
    public async Task<Guid> InsertUploadedAsync(NewFileRecord file, CancellationToken cancellationToken)
    {
        const string sql = $"""
            INSERT INTO files (file_name, kind, status, content, content_sha256, uploaded_by, uploaded_at)
            VALUES (@FileName, @Kind, '{FileStatusValue.Uploaded}', @Content, @ContentSha256, @UploadedBy, @UploadedAt)
            RETURNING id
            """;
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        return await connection.ExecuteScalarAsync<Guid>(new CommandDefinition(sql, file, cancellationToken: cancellationToken));
    }
}
