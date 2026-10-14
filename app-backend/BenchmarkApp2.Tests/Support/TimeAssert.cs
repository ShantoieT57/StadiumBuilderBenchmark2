namespace BenchmarkApp2.Tests.Support;

/// <summary>Compares times read from the database with the scenario's clock.</summary>
public static class TimeAssert
{
    /// <summary>Database timestamps keep microseconds, so times are compared to the nearest millisecond.</summary>
    private static readonly TimeSpan Tolerance = TimeSpan.FromMilliseconds(1);

    /// <summary>Asserts that a UTC time read from the database is the clock's current time.</summary>
    public static void IsCurrentTime(DateTime databaseTime, ManualTimeProvider clock) =>
        Assert.Equal(clock.GetUtcNow(), new DateTimeOffset(DateTime.SpecifyKind(databaseTime, DateTimeKind.Utc)), Tolerance);
}
