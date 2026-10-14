// Generates an NSwag config file from the nswag-template.json template file.
//
// Usage:
//   dotnet run generate-nswag.cs -- <project-root-path> <project-root-namespace> <openapi-spec-filename> <service-name>

using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

const string NSwagTemplateRelativePath = "nswag-template.json";

if(!TryParseArgs(args, out string projectRootPath, out string projectRootNamespace, out string openapiSpecFileName, out string serviceName, out string? errorMessage))
{
    Console.Error.WriteLine("Usage: dotnet run generate-nswag.cs -- <project-root-path> <project-root-namespace> <openapi-spec-filename> <service-name>");
    Console.Error.WriteLine("Argument error: " + errorMessage);
    return 1;
}

try
{
    string templateFilePath = Path.Combine(ScriptFolderPath(), NSwagTemplateRelativePath);
    if (!File.Exists(templateFilePath))
    {
        throw new FailException($"NSwag template not found at '{templateFilePath}'.");
    }

    string templateText = File.ReadAllText(templateFilePath);
    string nswagContent = Render(templateText, new Dictionary<string, string>
    {
        ["openapiSpecFileName"] = openapiSpecFileName,
        ["projectRootNamespace"] = projectRootNamespace,
        ["serviceName"] = serviceName,
    });

    string outputFolderPath = Path.GetFullPath(Path.Combine(projectRootPath, "NSwag"));
    Directory.CreateDirectory(outputFolderPath);

    string outputFileName = $"{Path.GetFileNameWithoutExtension(openapiSpecFileName)}.nswag";
    string outputFilePath = Path.Combine(outputFolderPath, outputFileName);
    File.WriteAllText(outputFilePath, nswagContent);

    var summary = new JsonObject { ["outputFilePath"] = outputFilePath };
    Console.WriteLine(summary.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
    return 0;
}
catch (FailException exception)
{
    Console.Error.WriteLine($"ERROR: {exception.Message}");
    return 1;
}

static bool TryParseArgs(string[] args, out string projectRootPath, out string projectRootNamespace, out string openapiSpecFileName, out string serviceName, out string? errorMessage)
{
    projectRootPath = args.ElementAtOrDefault(0) ?? "";
    projectRootNamespace = args.ElementAtOrDefault(1) ?? "";
    openapiSpecFileName = args.ElementAtOrDefault(2) ?? "";
    serviceName = args.ElementAtOrDefault(3) ?? "";

    if (string.IsNullOrEmpty(projectRootPath))
    {
        errorMessage = "No project root path provided.";
        return false;
    }
    if (string.IsNullOrEmpty(projectRootNamespace))
    {
        errorMessage = "No project root namespace provided.";
        return false;
    }
    if (string.IsNullOrEmpty(openapiSpecFileName))
    {
        errorMessage = "No OpenAPI spec file name provided.";
        return false;
    }
    if (string.IsNullOrEmpty(serviceName))
    {
        errorMessage = "No service name provided.";
        return false;
    }

    errorMessage = null;
    return true;
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
