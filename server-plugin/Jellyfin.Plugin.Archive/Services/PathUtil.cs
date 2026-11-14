using System;
using System.IO;

namespace Jellyfin.Plugin.Archive.Services;

/// <summary>Path helpers.</summary>
public static class PathUtil
{
    private static StringComparison Comparison => OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;

    /// <summary>Removes trailing separators.</summary>
    /// <param name="path">The path.</param>
    /// <returns>The trimmed path.</returns>
    public static string Trim(string path) => Path.TrimEndingDirectorySeparator(Path.GetFullPath(path));

    /// <summary>Whether <paramref name="path"/> is <paramref name="root"/> or somewhere under it.</summary>
    /// <param name="path">The path.</param>
    /// <param name="root">The folder.</param>
    /// <returns>True when inside.</returns>
    public static bool IsSameOrInside(string path, string root)
    {
        if (string.IsNullOrEmpty(path) || string.IsNullOrEmpty(root))
        {
            return false;
        }

        var p = Trim(path);
        var r = Trim(root);
        return p.Equals(r, Comparison)
            || p.StartsWith(r + Path.DirectorySeparatorChar, Comparison)
            || p.StartsWith(r + Path.AltDirectorySeparatorChar, Comparison);
    }

    /// <summary>Whether two paths are the same.</summary>
    /// <param name="a">One path.</param>
    /// <param name="b">The other.</param>
    /// <returns>True when equal.</returns>
    public static bool Same(string a, string b) => Trim(a).Equals(Trim(b), Comparison);
}
