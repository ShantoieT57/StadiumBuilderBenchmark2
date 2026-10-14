# <a id="Twenty57_Builder_ApplicationRuntime_Interfaces_IService"></a> Interface IService

Namespace: [Twenty57.Builder.ApplicationRuntime.Interfaces](Twenty57.Builder.ApplicationRuntime.Interfaces.md)  
Assembly: Twenty57.Builder.ApplicationRuntime.Interfaces.dll  

Represents a service of the application that can be started and stopped.

```csharp
public interface IService : IHostedService
```

#### Implements

[IHostedService](https://learn.microsoft.com/dotnet/api/microsoft.extensions.hosting.ihostedservice)

## Properties

### <a id="Twenty57_Builder_ApplicationRuntime_Interfaces_IService_IsRunning"></a> IsRunning

Gets a value indicating whether the service is running.

```csharp
bool IsRunning { get; }
```

#### Property Value

 [bool](https://learn.microsoft.com/dotnet/api/system.boolean)

