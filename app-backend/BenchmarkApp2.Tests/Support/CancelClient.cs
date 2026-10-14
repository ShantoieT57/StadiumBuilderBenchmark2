using System.Net;

namespace BenchmarkApp2.Tests.Support;

/// <summary>Cancels files as the signed-in person.</summary>
public sealed class CancelClient(TransactionApiFixture api, ApiScenarioState state)
{
    public Task<HttpResponseMessage> SendCancelAsync(Guid fileId) => SendCancelAsync(fileId, state.SessionCookie);

    public Task<HttpResponseMessage> SendCancelAsync(Guid fileId, string? sessionCookie) =>
        api.SendAsync(HttpMethod.Post, $"files/{fileId}/cancel", sessionCookie: sessionCookie);

    /// <summary>Cancels the file and records the response as the scenario's last response.</summary>
    public async Task CancelAsync(Guid fileId) => await state.RecordResponseAsync(await SendCancelAsync(fileId));

    /// <summary>Cancels the file and requires the cancel to succeed.</summary>
    public async Task CancelSuccessfullyAsync(Guid fileId)
    {
        await CancelAsync(fileId);
        Assert.Equal(HttpStatusCode.OK, state.LastResponse.StatusCode);
    }
}
