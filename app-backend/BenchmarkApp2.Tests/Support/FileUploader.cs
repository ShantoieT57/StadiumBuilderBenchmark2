using System.Net;
using System.Text.Json;

namespace BenchmarkApp2.Tests.Support;

/// <summary>Uploads files as the signed-in person and remembers the ids and bytes of the accepted files.</summary>
public sealed class FileUploader(TransactionApiFixture api, ApiScenarioState state)
{
    private const string UploadPath = "files";

    /// <summary>Uploads a file, requires it to be accepted and remembers its id.</summary>
    public async Task UploadAndRememberAsync(byte[] content, string fileName)
    {
        var form = TestFiles.CreateUploadForm(content, fileName, kind: null);
        await state.RecordResponseAsync(await api.SendContentAsync(HttpMethod.Post, UploadPath, form, state.SessionCookie));
        Assert.Equal(HttpStatusCode.Created, state.LastResponse.StatusCode);

        using var json = JsonDocument.Parse(state.LastResponseBody);
        state.UploadedFileIds.Add(json.RootElement.GetProperty("id").GetGuid());
        state.UploadedFileContents.Add(content);
    }
}
