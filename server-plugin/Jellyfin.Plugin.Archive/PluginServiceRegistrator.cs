using Jellyfin.Plugin.Archive.Services;
using MediaBrowser.Controller;
using MediaBrowser.Controller.Plugins;
using Microsoft.Extensions.DependencyInjection;

namespace Jellyfin.Plugin.Archive;

/// <summary>Registers the plugin's services.</summary>
public class PluginServiceRegistrator : IPluginServiceRegistrator
{
    /// <inheritdoc />
    public void RegisterServices(IServiceCollection serviceCollection, IServerApplicationHost applicationHost)
    {
        serviceCollection.AddSingleton<ArchiveStore>();
        serviceCollection.AddSingleton<ArchiveService>();
        serviceCollection.AddHostedService<ArchiveHostedService>();
    }
}
