using System.Text;
using BenchmarkApp2.Data;

namespace BenchmarkApp2.Services.FileProcessor;

/// <summary>
/// Reads a bank transactions file: comma-separated, UTF-8 (with or without a byte order mark), a
/// header row followed by one row per transaction in the column order Reference, TransactionDate,
/// AccountNumber, Description, Amount, TransactionType, Currency. Columns are read by position; the
/// header row is skipped, not checked.
/// </summary>
public static class TransactionFileReader
{
    /// <summary>The number of columns a transaction row has.</summary>
    public const int ColumnCount = 7;

    /// <summary>
    /// Stage 1 (Receive): the transaction records of the file, not counting the header or blank lines.
    /// A NUL character, which the database cannot store as text, is replaced with U+FFFD.
    /// </summary>
    public static IReadOnlyList<string[]> ReadRecords(byte[] content)
    {
        var text = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false).GetString(content)
            .TrimStart('﻿')
            .Replace('\0', '�');
        return CsvParser.Parse(text).Skip(1).ToList();
    }

    /// <summary>
    /// Stage 3 (Read rows): each record as a row of original values, numbered from 1. A record with
    /// fewer columns than expected has its missing values left empty; values beyond the expected
    /// columns are kept as extra values.
    /// </summary>
    public static IReadOnlyList<FileRowValues> ReadRows(IReadOnlyList<string[]> records) =>
        records.Select((record, index) =>
        {
            string Column(int position) => position < record.Length ? record[position] : string.Empty;
            return new FileRowValues(
                RowNumber: index + 1,
                Reference: Column(0),
                TransactionDate: Column(1),
                AccountNumber: Column(2),
                Description: Column(3),
                Amount: Column(4),
                TransactionType: Column(5),
                Currency: Column(6),
                ColumnCount: record.Length,
                ExtraValues: record.Skip(ColumnCount).ToArray());
        }).ToList();
}
