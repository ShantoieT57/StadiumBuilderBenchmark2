using System.Net;
using System.Text.Json;
using BenchmarkApp2.Tests.Support;
using Reqnroll;

namespace BenchmarkApp2.Tests.StepDefinitions;

[Binding]
public sealed class CommonStepDefinitions(TransactionApiFixture api, ApiScenarioState state)
{
    private const string SeededPassword = "Test123";

    [Given("I am signed in as {string}")]
    public async Task GivenIAmSignedInAs(string email)
    {
        var response = await api.SendAsync(HttpMethod.Post, "auth/sign-in", new { email, password = SeededPassword });
        await state.RecordResponseAsync(response);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        state.SessionCookie = state.IssuedSessionCookieValue;
        Assert.NotNull(state.SessionCookie);
    }

    [Then("the response status code is {int}")]
    public void ThenTheResponseStatusCodeIs(int statusCode)
    {
        Assert.Equal(statusCode, (int)state.LastResponse.StatusCode);
    }

    [Then("the response message is {string}")]
    public void ThenTheResponseMessageIs(string message)
    {
        using var json = JsonDocument.Parse(state.LastResponseBody);
        Assert.Equal(message, json.RootElement.GetProperty("message").GetString());
    }

    [Then("the response describes the user {string} with email {string} and role {string}")]
    public void ThenTheResponseDescribesTheUser(string name, string email, string role)
    {
        using var json = JsonDocument.Parse(state.LastResponseBody);
        Assert.Equal(name, json.RootElement.GetProperty("name").GetString());
        Assert.Equal(email, json.RootElement.GetProperty("email").GetString());
        Assert.Equal(role, json.RootElement.GetProperty("role").GetString());
    }
}
