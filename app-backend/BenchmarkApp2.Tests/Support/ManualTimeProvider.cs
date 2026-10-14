namespace BenchmarkApp2.Tests.Support;

/// <summary>
/// A clock the scenarios move forward explicitly, so time-based rules (such as the session
/// inactivity timeout) are tested without waiting. Starts at the real current time.
/// </summary>
public sealed class ManualTimeProvider : TimeProvider
{
    private DateTimeOffset _utcNow = DateTimeOffset.UtcNow;

    public override DateTimeOffset GetUtcNow() => _utcNow;

    public void Advance(TimeSpan duration) => _utcNow += duration;

    public void SetUtcNow(DateTimeOffset utcNow) => _utcNow = utcNow;
}
