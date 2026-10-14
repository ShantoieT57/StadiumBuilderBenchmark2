using Reqnroll;

namespace BenchmarkApp2.Tests.Support;

[Binding]
public sealed class Hooks
{
    [BeforeTestRun]
    public static Task RecreateDatabaseAsync() => TestDatabase.RecreateAsync();

    [BeforeScenario]
    public static Task ResetDatabaseAsync() => TestDatabase.ResetAsync();
}
