using System.Net;
using System.Text.Json;
using BenchmarkApp2.Services.TransactionApi;
using BenchmarkApp2.Tests.Support;
using Reqnroll;

namespace BenchmarkApp2.Tests.StepDefinitions;

[Binding]
public sealed class CommonStepDefinitions(TransactionApiFixture api, ApiScenarioState state, ManualTimeProvider clock)
{
    private const string SeededPassword = "Test123";

    [Given("I am signed in as {string}")]
    public async Task GivenIAmSignedInAs(string email)
    {
        state.SessionCookie = await SignInAsync(email);
    }

    [Given("I am signed in as {string} in browser {string}")]
    [When("I sign in as {string} in browser {string}")]
    public async Task GivenIAmSignedInAsInBrowser(string email, string browser)
    {
        state.BrowserSessionCookies[browser] = await SignInAsync(email);
    }

    [When("I request the current user")]
    public Task WhenIRequestTheCurrentUser() => RequestCurrentUserAsync(state.SessionCookie);

    [When("I request the current user from browser {string}")]
    public Task WhenIRequestTheCurrentUserFromBrowser(string browser) =>
        RequestCurrentUserAsync(state.GetBrowserSessionCookie(browser));

    [When("{int} minutes pass")]
    public void WhenMinutesPass(int minutes)
    {
        clock.Advance(TimeSpan.FromMinutes(minutes));
    }

    [Then("the response status code is {int}")]
    public void ThenTheResponseStatusCodeIs(int statusCode)
    {
        Assert.Equal(statusCode, (int)state.LastResponse.StatusCode);
    }

    [Then("the response message is {string}")]
    public void ThenTheResponseMessageIs(string message)
    {
        Assert.Equal(message, GetResponseProperty("message"));
    }

    [Then("the response reason is {string}")]
    public void ThenTheResponseReasonIs(string reason)
    {
        Assert.Equal(reason, GetResponseProperty("reason"));
    }

    [Then("the validation errors include the field {string}")]
    public void ThenTheValidationErrorsIncludeTheField(string field)
    {
        using var json = JsonDocument.Parse(state.LastResponseBody);
        var fields = json.RootElement.GetProperty("errors").EnumerateObject().Select(error => error.Name);
        Assert.Contains(fields, name => string.Equals(name, field, StringComparison.OrdinalIgnoreCase));
    }

    [Then("the response describes the user {string} with email {string} and role {string}")]
    public void ThenTheResponseDescribesTheUser(string name, string email, string role)
    {
        using var json = JsonDocument.Parse(state.LastResponseBody);
        Assert.Equal(name, json.RootElement.GetProperty("name").GetString());
        Assert.Equal(email, json.RootElement.GetProperty("email").GetString());
        Assert.Equal(role, json.RootElement.GetProperty("role").GetString());
    }

    [Then("my session has ended with the reason {string}")]
    public Task ThenMySessionHasEndedWithTheReason(string endReason) =>
        AssertSessionEndReasonAsync(state.SessionCookie!, endReason);

    [Then("the session in browser {string} has ended with the reason {string}")]
    public Task ThenTheSessionInBrowserHasEndedWithTheReason(string browser, string endReason) =>
        AssertSessionEndReasonAsync(state.GetBrowserSessionCookie(browser), endReason);

    /// <summary>Signs in with the seeded password and returns the issued session cookie.</summary>
    private async Task<string> SignInAsync(string email)
    {
        var response = await api.SendAsync(HttpMethod.Post, "auth/sign-in", new { email, password = SeededPassword });
        await state.RecordResponseAsync(response);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var sessionCookie = state.IssuedSessionCookieValue;
        Assert.NotNull(sessionCookie);
        return sessionCookie;
    }

    private async Task RequestCurrentUserAsync(string? sessionCookie)
    {
        await state.RecordResponseAsync(await api.SendAsync(HttpMethod.Get, "auth/me", sessionCookie: sessionCookie));
    }

    private string? GetResponseProperty(string name)
    {
        using var json = JsonDocument.Parse(state.LastResponseBody);
        return json.RootElement.GetProperty(name).GetString();
    }

    private static async Task AssertSessionEndReasonAsync(string sessionCookie, string endReason)
    {
        Assert.Equal(endReason, await TestDatabase.GetSessionEndReasonAsync(SessionCookie.HashToken(sessionCookie)));
    }
}
