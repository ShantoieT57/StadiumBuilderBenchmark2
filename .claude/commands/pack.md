---
description: Package a .NET application for deployment as a .t57 tarball
argument-hint: [csproj-file-path]
---

Package a .NET application for deployment into a `.t57` tarball that can be built into a Docker image or deployed to the Portal.

Arguments: $ARGUMENTS

Steps:

1. Determine which project to pack:
   - If a `.csproj` file path was given in the arguments, or the user named a specific project in the conversation, use that.
   - Otherwise, find the application project automatically: locate the `.csproj` whose folder contains a `Program.cs` file (this marks the deployable app — the `*.Tests` project does not have one). Search the solution folder and ignore any `bin` and `obj` folders.
     - If exactly one such project is found, use it.
     - If more than one is found, list them and ask the user which to pack.
     - If none is found, stop and tell the user no application project (a project with a `Program.cs`) could be found to pack.

   When the project to pack was specified by the user (either directly or chosen from a presented list), proceed without confirming.

   When the project was inferred automatically rather than specified, **STOP and confirm before continuing.** Tell the user which project you intend to pack (e.g. its name and `.csproj` path) and ask them to confirm it is correct. Do not run the packing script until they explicitly approve. This lets them catch a wrong choice before the artifact is built.

2. Verify the .NET 10 SDK is installed by running `dotnet --list-sdks`. If the output contains no line beginning with `10.`, stop and tell the user they must install the .NET 10 SDK before `/pack` can run. (The packing script uses the file-based app feature introduced in .NET 10; an older SDK would produce a confusing compiler error.)

3. Run the packing script, forwarding the path to the `.csproj` file:

   ```
   dotnet run .claude/scripts/pack.cs -- <csproj-file-path>
   ```

   The first invocation may take 10–20 seconds while .NET compiles the file-based script — this is normal; do not cancel.

   The script performs all of the following: validates that the `.csproj` exists and that its folder contains a `Program.cs`, locates the solution (`.sln`/`.slnx`) above the project to anchor the `docs` and `artifacts` folders, generates a `Dockerfile` from the template (substituting the project name), and writes a gzip-compressed tarball to `artifacts/<ProjectName>.t57` containing the `Dockerfile` at the root plus `src/<project>` (excluding the project's `bin`/`obj` folders and any `*.g.cs` files) and `src/docs` (the solution-root `docs` folder, included only if it exists). The project must live under a solution folder — if no `.sln`/`.slnx` is found above it, the script exits non-zero. If any precondition fails, the script exits non-zero — report its error output to the user and stop.

4. Report the result (package file path and project name) using the JSON summary printed.
