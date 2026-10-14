// Packages a .NET application into a gzip-compressed .t57 tarball for deployment.
// This script is used by the /pack skill to produce a single deployable artifact containing the
// project source, the solution's docs folder (if present) and a Dockerfile that builds the app into a Docker image.
//
// Usage:
//   dotnet run pack.cs -- <csproj-file-path>

using System.Formats.Tar;
using System.IO.Compression;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

const string DockerfileTemplateRelativePath = "dockerfile-template";

if (!TryParseArgs(args, out string csprojFilePath, out string? errorMessage))
{
    Console.Error.WriteLine("Usage: dotnet run pack.cs -- <csproj-file-path>");
    Console.Error.WriteLine("Argument error: " + errorMessage);
    return 1;
}

try
{
    string fullCsprojFilePath = Path.GetFullPath(csprojFilePath);
    string projectFolderPath = Path.GetDirectoryName(fullCsprojFilePath)!;

    if (!File.Exists(Path.Combine(projectFolderPath, "Program.cs")))
    {
        throw new FailException($"No Program.cs found in project folder '{projectFolderPath}'. /pack expects the main application project.");
    }

    string templateFilePath = Path.Combine(ScriptFolderPath(), DockerfileTemplateRelativePath);
    if (!File.Exists(templateFilePath))
    {
        throw new FailException($"Dockerfile template not found at '{templateFilePath}'.");
    }

    string projectName = Path.GetFileNameWithoutExtension(fullCsprojFilePath);
    string solutionFolderPath = FindSolutionFolder(projectFolderPath);
    string artifactsFolderPath = Path.Combine(solutionFolderPath, "artifacts");
    string packageFilePath = Path.Combine(artifactsFolderPath, $"{projectName}.t57");

    Directory.CreateDirectory(artifactsFolderPath);

    using (FileStream fileStream = File.Create(packageFilePath))
    using (var gzipStream = new GZipStream(fileStream, CompressionLevel.Optimal))
    using (var tarWriter = new TarWriter(gzipStream, TarEntryFormat.Pax))
    {
        PackDockerfile(tarWriter, projectName, templateFilePath);

        string docsFolderPath = Path.Combine(solutionFolderPath, "docs");
        if (Directory.Exists(docsFolderPath))
        {
            PackFolder(tarWriter, docsFolderPath, "src/docs", excludeBinAndObj: false, excludeGenerated: true);
        }

        PackFolder(tarWriter, projectFolderPath, $"src/{projectName}", excludeBinAndObj: true, excludeGenerated: true);
    }

    var summary = new JsonObject
    {
        ["packageFilePath"] = packageFilePath,
        ["projectName"] = projectName,
    };
    Console.WriteLine(summary.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
    return 0;
}
catch (FailException exception)
{
    Console.Error.WriteLine($"ERROR: {exception.Message}");
    return 1;
}

static bool TryParseArgs(string[] args, out string csprojFilePath, out string? errorMessage)
{
    csprojFilePath = args.ElementAtOrDefault(0) ?? "";

    if (string.IsNullOrEmpty(csprojFilePath))
    {
        errorMessage = "No csproj file path provided.";
        return false;
    }
    if (!csprojFilePath.EndsWith(".csproj", StringComparison.OrdinalIgnoreCase))
    {
        errorMessage = $"Project file '{csprojFilePath}' is not a .csproj file.";
        return false;
    }
    if (!File.Exists(csprojFilePath))
    {
        errorMessage = $"Project file '{csprojFilePath}' not found.";
        return false;
    }

    errorMessage = null;
    return true;
}

static string FindSolutionFolder(string projectFolderPath)
{
    for (DirectoryInfo? directoryInfo = new(projectFolderPath); directoryInfo is not null; directoryInfo = directoryInfo.Parent)
    {
        if (directoryInfo.EnumerateFiles().Any(file => file.Extension is ".sln" or ".slnx"))
        {
            return directoryInfo.FullName;
        }
    }
    throw new FailException($"No solution (.sln/.slnx) found above '{projectFolderPath}'. /pack anchors the docs and artifacts folders at the solution root.");
}

static void PackDockerfile(TarWriter tarWriter, string projectName, string templateFilePath)
{
    string dockerfileContent = Render(File.ReadAllText(templateFilePath), new Dictionary<string, string>
    {
        ["projectName"] = projectName
    }).Replace("\r\n", "\n");

    using var memoryStream = new MemoryStream(Encoding.UTF8.GetBytes(dockerfileContent));
    tarWriter.WriteEntry(new PaxTarEntry(TarEntryType.RegularFile, "Dockerfile")
    {
        DataStream = memoryStream,
    });
}

static void PackFolder(TarWriter tarWriter, string sourceFolderPath, string entryPrefix, bool excludeBinAndObj, bool excludeGenerated)
{
    tarWriter.WriteEntry(new PaxTarEntry(TarEntryType.Directory, entryPrefix.TrimEnd('/') + "/"));

    foreach (string filePath in Directory.EnumerateFiles(sourceFolderPath))
    {
        if (excludeGenerated && filePath.EndsWith(".g.cs", StringComparison.OrdinalIgnoreCase)) continue;
        tarWriter.WriteEntry(filePath, $"{entryPrefix}/{Path.GetFileName(filePath)}");
    }

    foreach (string folderPath in Directory.EnumerateDirectories(sourceFolderPath))
    {
        string folderName = Path.GetFileName(folderPath);
        if (excludeBinAndObj && (folderName.Equals("bin", StringComparison.OrdinalIgnoreCase)
                             || folderName.Equals("obj", StringComparison.OrdinalIgnoreCase))) continue;
        PackFolder(tarWriter, folderPath, $"{entryPrefix}/{folderName}", excludeBinAndObj, excludeGenerated);
    }
}

static string Render(string template, Dictionary<string, string> values)
{
    return Regex.Replace(template, @"\{\{(\w+)\}\}", match =>
    {
        string key = match.Groups[1].Value;
        if (!values.TryGetValue(key, out string? value))
        {
            throw new FailException($"Template references unknown placeholder '{{{{{key}}}}}'.");
        }
        return value;
    });
}

// [CallerFilePath] resolves at compile time to the absolute path of this source file.
// AppContext.BaseDirectory would point at the file-based app build cache.
static string ScriptFolderPath([CallerFilePath] string path = "") => Path.GetDirectoryName(Path.GetFullPath(path))!;

internal sealed class FailException(string message) : Exception(message);
