namespace BenchmarkApp2.Services.TransactionApi;

/// <summary>
/// Marks an operation whose requests do not count as activity on the session, so they never reset
/// its inactivity timeout (SI-06). The session must still be active for the request to be allowed.
/// </summary>
[AttributeUsage(AttributeTargets.Method)]
public sealed class NotSessionActivityAttribute : Attribute;
