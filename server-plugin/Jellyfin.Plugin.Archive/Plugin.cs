using System;
using System.Collections.Generic;
using System.Globalization;
using Jellyfin.Plugin.Archive.Configuration;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Model.Plugins;
using MediaBrowser.Model.Serialization;

namespace Jellyfin.Plugin.Archive;

/// <summary>
/// The Archive plugin: a second home for movies and shows that should stay on the server
/// without showing up next to everything else.
/// </summary>
public class Plugin : BasePlugin<PluginConfiguration>, IHasWebPages
{
    /// <summary>
    /// Initializes a new instance of the <see cref="Plugin"/> class.
    /// </summary>
    /// <param name="applicationPaths">The application paths.</param>
    /// <param name="xmlSerializer">The XML serializer.</param>
    public Plugin(IApplicationPaths applicationPaths, IXmlSerializer xmlSerializer)
        : base(applicationPaths, xmlSerializer)
    {
        Instance = this;
        if (Configuration.MigrateFirstVersion())
        {
            SaveConfiguration();
        }
    }

    /// <summary>Raised after the admin saves the plugin settings.</summary>
    public event EventHandler<PluginConfiguration>? ConfigurationSaved;

    /// <summary>Gets the running instance.</summary>
    public static Plugin? Instance { get; private set; }

    /// <inheritdoc />
    public override string Name => "Archive";

    /// <inheritdoc />
    public override Guid Id => Guid.Parse("6f3c2a4e-8b1d-4f7a-9c2e-5a1b7d3e9f40");

    /// <inheritdoc />
    public override string Description =>
        "Move movies and shows into an archive or a soft delete library that stay out of the main library, with per-user rights to move and to view.";

    /// <inheritdoc />
    public override void UpdateConfiguration(BasePluginConfiguration configuration)
    {
        base.UpdateConfiguration(configuration);
        ConfigurationSaved?.Invoke(this, Configuration);
    }

    /// <inheritdoc />
    public IEnumerable<PluginPageInfo> GetPages()
    {
        return new[]
        {
            new PluginPageInfo
            {
                Name = Name,
                EmbeddedResourcePath = string.Format(CultureInfo.InvariantCulture, "{0}.Configuration.configPage.html", GetType().Namespace)
            }
        };
    }
}
