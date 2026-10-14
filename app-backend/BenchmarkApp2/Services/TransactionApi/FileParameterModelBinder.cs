using System.Text;
using Microsoft.AspNetCore.Mvc.ModelBinding;

namespace BenchmarkApp2.Services.TransactionApi;

/// <summary>
/// Binds the generated <see cref="FileParameter"/> from the multipart form part named after the
/// parameter, keeping the file name exactly as the client sent it. Apply it to the parameter with
/// <c>[ModelBinder(typeof(FileParameterModelBinder))]</c>. A part sent with an empty file name is a
/// file with an empty name (see <see cref="UploadFormReader"/>). A plain form field of that name,
/// sent with no file name at all, is bound as a file with an empty name too, so either is refused
/// like any other invalid file name.
/// </summary>
public sealed class FileParameterModelBinder : IModelBinder
{
    public async Task BindModelAsync(ModelBindingContext bindingContext)
    {
        var request = bindingContext.HttpContext.Request;
        if (!request.HasFormContentType)
        {
            return;
        }

        var form = await request.ReadFormAsync(bindingContext.HttpContext.RequestAborted);
        var name = bindingContext.ModelName;
        if (form.Files.GetFile(name) is { } file)
        {
            bindingContext.Result = ModelBindingResult.Success(new FileParameter(file.OpenReadStream(), file.FileName, file.ContentType));
        }
        else if (form.TryGetValue(name, out var value))
        {
            var content = Encoding.UTF8.GetBytes(value.ToString());
            bindingContext.Result = ModelBindingResult.Success(new FileParameter(new MemoryStream(content), string.Empty));
        }
    }
}
