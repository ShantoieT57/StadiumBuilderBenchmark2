# <a id="Twenty57_Builder_ApplicationRuntime_Sdk_Runner"></a> Class Runner

Namespace: [Twenty57.Builder.ApplicationRuntime.Sdk](Twenty57.Builder.ApplicationRuntime.Sdk.md)  
Assembly: Twenty57.Builder.ApplicationRuntime.Sdk.dll  

Provides a simple runner to initialize application settings from environment variables and start the provided host.

```csharp
public sealed class Runner
```

#### Inheritance

[object](https://learn.microsoft.com/dotnet/api/system.object) ← 
[Runner](Twenty57.Builder.ApplicationRuntime.Sdk.Runner.md)

#### Inherited Members

[object.Equals\(object?\)](https://learn.microsoft.com/dotnet/api/system.object.equals\#system\-object\-equals\(system\-object\)), 
[object.Equals\(object?, object?\)](https://learn.microsoft.com/dotnet/api/system.object.equals\#system\-object\-equals\(system\-object\-system\-object\)), 
[object.GetHashCode\(\)](https://learn.microsoft.com/dotnet/api/system.object.gethashcode), 
[object.GetType\(\)](https://learn.microsoft.com/dotnet/api/system.object.gettype), 
[object.ReferenceEquals\(object?, object?\)](https://learn.microsoft.com/dotnet/api/system.object.referenceequals), 
[object.ToString\(\)](https://learn.microsoft.com/dotnet/api/system.object.tostring)

## Methods

### <a id="Twenty57_Builder_ApplicationRuntime_Sdk_Runner_RunAsync_Microsoft_Extensions_Hosting_IHost_System_Threading_CancellationToken_"></a> RunAsync\(IHost, CancellationToken\)

Initializes setting values from environment variables and runs the provided host as well as the application service gRPC endpoint.

```csharp
public static Task RunAsync(IHost host, CancellationToken token = default)
```

#### Parameters

`host` [IHost](https://learn.microsoft.com/dotnet/api/microsoft.extensions.hosting.ihost)

The host to run. Must provide a registered <xref href="Twenty57.Builder.ApplicationRuntime.Interfaces.IAppSettings" data-throw-if-not-resolved="false"></xref> service if settings are to be applied.

`token` [CancellationToken](https://learn.microsoft.com/dotnet/api/system.threading.cancellationtoken)

A cancellation token to observe while waiting for the host to shut down.

#### Returns

 [Task](https://learn.microsoft.com/dotnet/api/system.threading.tasks.task)

A task that completes when the host stops running.

