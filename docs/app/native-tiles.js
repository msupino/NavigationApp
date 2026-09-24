(function () {
  'use strict';
  const enabled = window.__navaidEmbedded === true;
  const ROOT = 'navaid-tiles-v1';
  const directory = 'LIBRARY_NO_CLOUD';
  const missing = error => error && (error.code === 'OS-PLUG-FILE-0008' || /does not exist/i.test(error.message));
  const keyUrl = key => typeof key === 'string' ? key : key.url;
  const filePath = key => ROOT + '/' + encodeURIComponent(keyUrl(key));

  function filesystem() {
    const fs = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem;
    if (!fs) throw new Error('Native offline charts require the Filesystem plugin');
    return fs;
  }

  async function readData(url) {
    try { return (await filesystem().readFile({ path: filePath(url), directory })).data; }
    catch (error) { if (missing(error)) return null; throw error; }
  }

  function base64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.readAsDataURL(blob);
    });
  }

  const cache = {
    async keys() {
      try {
        const result = await filesystem().readdir({ path: ROOT, directory });
        return result.files.filter(file => file.type === 'file').map(file => ({ url: decodeURIComponent(file.name) }));
      } catch (error) { if (missing(error)) return []; throw error; }
    },
    async put(key, response) {
      const data = await base64(await response.blob());
      await filesystem().writeFile({ path: filePath(key), directory, data, recursive: true });
    },
    async delete(key) {
      try { await filesystem().deleteFile({ path: filePath(key), directory }); return true; }
      catch (error) { if (missing(error)) return false; throw error; }
    },
  };
  const storage = {
    async has() { return (await cache.keys()).length > 0; },
    async open() { return cache; },
    async delete() {
      try { await filesystem().rmdir({ path: ROOT, directory, recursive: true }); return true; }
      catch (error) { if (missing(error)) return false; throw error; }
    },
  };

  async function imageUrl(url) {
    // Only hosts an offline pack can hold: every chart on our mirror, and open flightmaps. Any
    // other host (Satellite, OpenStreetMap) goes straight to the network without a file read.
    if (!enabled || !/^https:\/\/(navaid-tiles\.supino\.org\/|nwy-tiles-api\.prod\.newaydata\.com\/)/.test(url)) return url;
    try {
      const data = await readData(url);
      return data ? 'data:image/png;base64,' + data : url;
    } catch (error) { return url; }
  }

  let NativeTileLayer;
  function tileLayer(url, options) {
    if (!enabled) return L.tileLayer(url, options);
    if (!NativeTileLayer) {
      NativeTileLayer = L.TileLayer.extend({
        createTile(coords, done) {
          const tile = document.createElement('img');
          tile.alt = '';
          tile.setAttribute('role', 'presentation');
          if (this.options.crossOrigin) tile.crossOrigin = this.options.crossOrigin === true ? '' : this.options.crossOrigin;
          if (this.options.referrerPolicy) tile.referrerPolicy = this.options.referrerPolicy;
          tile.onload = () => done(null, tile);
          tile.onerror = error => {
            tile.onerror = null;
            tile.onload = null;
            if (this.options.errorTileUrl) tile.src = this.options.errorTileUrl;
            done(error, tile);
          };
          imageUrl(this.getTileUrl(coords)).then(src => {
            if (!tile._navaidUnloaded) tile.src = src;
          });
          return tile;
        },
      });
      NativeTileLayer.addInitHook(function () {
        this.on('tileunload', event => {
          event.tile._navaidUnloaded = true;
          event.tile.onload = null;
          event.tile.onerror = null;
        });
      });
    }
    return new NativeTileLayer(url, options);
  }

  window.NavAidNativeTiles = { enabled, storage, imageUrl, tileLayer };
}());
