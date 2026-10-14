namespace BenchmarkApp2.Tests.Support;

/// <summary>Approves and rejects transactions as a signed-in person.</summary>
public sealed class ReviewClient(TransactionApiFixture api, ApiScenarioState state)
{
    public Task<HttpResponseMessage> SendApproveAsync(Guid transactionId, string? sessionCookie) =>
        api.SendAsync(HttpMethod.Post, $"transactions/{transactionId}/approve", sessionCookie: sessionCookie);

    public Task<HttpResponseMessage> SendRejectAsync(Guid transactionId, string reason, string? sessionCookie) =>
        api.SendAsync(HttpMethod.Post, $"transactions/{transactionId}/reject", new { reason }, sessionCookie);

    /// <summary>Sends a reject request with exactly this JSON body.</summary>
    public Task<HttpResponseMessage> SendRejectWithBodyAsync(Guid transactionId, string jsonBody, string? sessionCookie) =>
        api.SendJsonTextAsync(HttpMethod.Post, $"transactions/{transactionId}/reject", jsonBody, sessionCookie);

    /// <summary>Approves the transaction as the scenario's signed-in person and records the response.</summary>
    public async Task ApproveAsync(Guid transactionId) =>
        await state.RecordResponseAsync(await SendApproveAsync(transactionId, state.SessionCookie));

    /// <summary>Rejects the transaction as the scenario's signed-in person and records the response.</summary>
    public async Task RejectAsync(Guid transactionId, string reason) =>
        await state.RecordResponseAsync(await SendRejectAsync(transactionId, reason, state.SessionCookie));

    /// <summary>Sends a reject request with exactly this JSON body and records the response.</summary>
    public async Task RejectWithBodyAsync(Guid transactionId, string jsonBody) =>
        await state.RecordResponseAsync(await SendRejectWithBodyAsync(transactionId, jsonBody, state.SessionCookie));
}
