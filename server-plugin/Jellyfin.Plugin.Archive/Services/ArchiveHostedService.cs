using System;
using System.Threading;
using System.Threading.Tasks;
using Jellyfin.Plugin.Archive.Configuration;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.Archive.Services;

/// <summary>
/// Keeps library access in step with the settings, and hands played state to titles that a scan
/// picked up after their move.
/// </summary>
public class ArchiveHostedService : IHostedService
{
    private readonly ArchiveService _archive;
    private readonly ILibraryManager _libraryManager;
    private readonly ILogger<ArchiveHostedService> _logger;

    /// <summary>
    /// Initializes a new instance of the <see cref="ArchiveHostedService"/> class.
    /// </summary>
    /// <param name="archive">The archive service.</param>
    /// <param name="libraryManager">The library manager.</param>
    /// <param name="logger">The logger.</param>
    public ArchiveHostedService(ArchiveService archive, ILibraryManager libraryManager, ILogger<ArchiveHostedService> logger)
    {
        _archive = archive;
        _libraryManager = libraryManager;
        _logger = logger;
    }

    /// <inheritdoc />
    public Task StartAsync(CancellationToken cancellationToken)
    {
        _libraryManager.ItemAdded += OnItemAdded;
        if (Plugin.Instance is not null)
        {
            Plugin.Instance.ConfigurationSaved += OnConfigurationSaved;
        }

        Sync();
        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public Task StopAsync(CancellationToken cancellationToken)
    {
        _libraryManager.ItemAdded -= OnItemAdded;
        if (Plugin.Instance is not null)
        {
            Plugin.Instance.ConfigurationSaved -= OnConfigurationSaved;
        }

        return Task.CompletedTask;
    }

    private void OnConfigurationSaved(object? sender, PluginConfiguration e) => Sync();

    private void OnItemAdded(object? sender, ItemChangeEventArgs e)
    {
        try
        {
            if (e.Item is CollectionFolder)
            {
                // A new library: people the plugin restricted should still get it.
                Sync();
                return;
            }

            if (_archive.HasPendingPlayedState(e.Item.Path))
            {
                _archive.ApplyPendingPlayedState(e.Item);
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Archive: handling a newly added item failed");
        }
    }

    private void Sync()
    {
        _ = Task.Run(async () =>
        {
            try
            {
                await _archive.SyncAccessAsync(CancellationToken.None).ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Archive: updating library access failed");
            }
        });
    }
}
