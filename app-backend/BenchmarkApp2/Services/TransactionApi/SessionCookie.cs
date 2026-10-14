using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.WebUtilities;

namespace BenchmarkApp2.Services.TransactionApi;

/// <summary>
/// The HttpOnly cookie that carries the opaque session token. Only a SHA-256 hash of the token
/// is ever stored, so a leaked sessions table cannot be used to impersonate anyone.
/// </summary>
public static class SessionCookie
{
    public const string Name = "txn_session";

    public static string CreateToken() => WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(32));

    public static byte[] HashToken(string token) => SHA256.HashData(Encoding.UTF8.GetBytes(token));

    public static bool TryRead(HttpRequest request, out string token)
    {
        token = request.Cookies[Name] ?? string.Empty;
        return token.Length > 0;
    }

    public static void Append(HttpResponse response, string token) =>
        response.Cookies.Append(Name, token, CreateOptions(response.HttpContext.Request));

    public static void Delete(HttpResponse response) =>
        response.Cookies.Delete(Name, CreateOptions(response.HttpContext.Request));

    private static CookieOptions CreateOptions(HttpRequest request) => new()
    {
        HttpOnly = true,
        Secure = request.IsHttps,
        SameSite = SameSiteMode.Lax,
        Path = "/",
    };
}
