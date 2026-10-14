using System.Text.Json;
using Reqnroll;

namespace BenchmarkApp2.Tests.Support;

/// <summary>Compares a processing history in a response with a scenario table.</summary>
public static class ProcessingHistoryAssert
{
    /// <summary>
    /// Asserts the history is exactly the table's stages, in order, with the times given in the
    /// <c>started</c> and <c>finished</c> columns (ISO 8601; empty means not finished).
    /// </summary>
    public static void AreStages(DataTable expected, JsonElement history)
    {
        var stages = history.EnumerateArray().ToList();
        Assert.Equal(expected.RowCount, stages.Count);
        foreach (var (row, stage) in expected.Rows.Zip(stages))
        {
            Assert.Equal(row["stage"], stage.GetProperty("stage").GetString());
            JsonFields.AssertValue("startedAt", row["started"], stage.GetProperty("startedAt"));
            JsonFields.AssertValue("finishedAt", row["finished"], stage.GetProperty("finishedAt"));
        }
    }
}
