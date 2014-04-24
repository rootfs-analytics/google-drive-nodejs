var utils = require('./utils.js');
var fs = require('fs');
var path = require('path');

var googleapis = require('googleapis');

function GoogleDrive(profile, googleAuth) {
  var self = this;

  //self.drive = {};

  var _cacheFile = path.join(profile.path, 'google_drive.cache.json');
  var _cache = {
    largestChangeId: 1,
    items: {}
  };
  var _pathIndex = {};
  var _rootItem = {};

  /* -------------------------- PUBLIC METHODS -------------------------- */

  self.load = function(cb) {
    googleapis.discover('drive', 'v2')
      .withAuthClient(googleAuth.auth)
      .execute(function(err, client) {
        if (err) { return cb(err); }

        self.drive = client.drive;
        utils.logWithTimestamp('Retrieved a reference to Google Drive for profile \'' + profile.name + '\'.');

        _loadAbout(function(err, about) {
          if (err) { return cb(err); }

          _loadCache(function(err) {
            if (err && (!err.code || err.code !== 'ENOENT')) { return cb(err); }

            _loadChanges(function(err) {
              if (err) { return cb(err); }

              setInterval(_loadChanges, 10*1000);

              cb(null);
            });
          });
        });
      });
  };

  //---------------------------------------------------------------------------

  self.getItemByPath = function(path) {
    return _pathIndex[path];
  };

  //---------------------------------------------------------------------------

  self.getFileBytesByRange = function(item, start, end, cb, dontRetry) {
    var request_opts = {
      uri: item.downloadUrl,
      encoding: null,
      headers: {
        'Range': 'bytes=' + start + '-' + end
      }
    };
    googleAuth.auth.request(request_opts, function(err, body, response) {
      if (err) { return cb(err); }
      if (response.statusCode === 403 && !dontRetry) {
        self.drive.files.get({fileId: item.id}).execute(function(err, resp) {
          if (err) { return cb(err); }

          console.log('retry', item.downloadUrl, resp.downloadUrl);
          item.downloadUrl = resp.downloadUrl;

          self.getFileBytesByRange(item, start, end, cb, false);
        });
      } else {
        if (response.statusCode !== 206) { return cb(new Error('Error. HttpStatusCode=' + response.statusCode)); }

        cb(null, body);
      }
    });
  };

  /* -------------------------- PRIVATE METHODS -------------------------- */

  function _loadAbout(cb){
    self.drive.about.get().execute(function(err, resp) {
      if (err) { return cb(err); }

      var bytesUsed = new Number(resp.quotaBytesUsed);
      var bytesUsedAggregate = new Number(resp.quotaBytesUsedAggregate);
      var bytesTotal = new Number(resp.quotaBytesTotal);

      utils.logWithTimestamp('Hello, ' + resp.user.displayName + ' (used ' + bytesUsed.bytesToSize() + ' / ' + bytesUsedAggregate.bytesToSize() + ' of ' + bytesTotal.bytesToSize() + ')');

      cb(null, resp);
    });
  }

  //---------------------------------------------------------------------------

  function _loadChanges(cb) {
    var MAX_RESULTS = 100;

    if (typeof(cb) !== 'function'){
      cb = function(err) {
        if (err) { console.error(err); }
      };
    }

    var largestChangeId = _cache.largestChangeId;

    var getPageOfChanges = function(request, changes) {
      var start = Date.now();
      request.execute(function(err, resp) {
        if (err) { return cb(err); }
        if (resp.largestChangeId === _cache.largestChangeId) { return cb(null); }

        utils.logWithTimestamp('Retrieved a page of Google Drive changes for profile \'' + profile.name + '\'. (' + resp.items.length + ' items, ' + (Date.now() - start) + ' ms.)');

        largestChangeId = resp.largestChangeId;
        changes = changes.concat(resp.items);

        var nextPageToken = resp.nextPageToken;
        if (nextPageToken) {
          request = self.drive.changes.list({
            maxResults: MAX_RESULTS,
            startChangeId: _cache.largestChangeId,
            pageToken: nextPageToken,
          });
          getPageOfChanges(request, changes);
        } else {

          _cache.largestChangeId = largestChangeId;
          changes.forEach(function(change) {
            if (change.deleted) {
              delete _cache.items[change.fileId];
            } else {
              change.file.type = change.file.mimeType === "application/vnd.google-apps.folder" ? "folder" : "file";
              _cache.items[change.fileId] = change.file;
            }
          });

          _buildIndexes();

          _saveCache(cb);
        }
      });
    };
    var initialRequest = self.drive.changes.list({
      maxResults: MAX_RESULTS,
      startChangeId: _cache.largestChangeId
    });
    getPageOfChanges(initialRequest, []);
  }

  //---------------------------------------------------------------------------

  function _buildIndexes() {
    var idIndex = {};
    var pathIndex = {};
    var rootItem = { type: 'folder', childItems: [] };
    pathIndex['/'] = rootItem;

    var totalSize = 0;

    for (var key in _cache.items) {
      var item = JSON.parse(JSON.stringify(_cache.items[key] ));

      idIndex[item.id] = item;
      if (item.type === 'folder') {
        item.childItems = [];
      }
      if (item.fileSize) {
        totalSize += new Number(item.fileSize);
      }
    }

    var getParentPaths = function(item) {
      if (!item.parents || item.parents.length === 0) {
        console.warn('no parents:', item.id + ' - ' + item.title);
        return [];
      } else {
        var paths = [];
        item.parents.forEach(function (parent) {
          if (parent.isRoot) {
            paths.push("");

            if (rootItem.childItems.indexOf(item) === -1)
              rootItem.childItems.push(item);

          } else {
            var parentItem = idIndex[parent.id];
            if (!parentItem) {
              console.warn('parent item not found: ', item.id  + ' - ' + item.title + ' - ' + parent.id);
            } else {
              if (parentItem.childItems.indexOf(item) === -1)
                parentItem.childItems.push(item);

              var parentPaths = getParentPaths(parentItem);
              //console.log('parentPaths:', parentPaths);
              for (var i = 0; i < parentPaths.length; i++) {
                paths.push(parentPaths[i] + '/' + parentItem.title);
              }
            }
          }
        });
        return paths;
      }
    };

    for (var key in idIndex) {
      var item = idIndex[key];

      var parentPaths = getParentPaths(item);
      //console.log(parentPaths);
      parentPaths.forEach(function(parentPath) {
        var path = parentPath + '/' + item.title;
        //console.log('path: ' + path + ' - ' + item.type);
        pathIndex[path] = item;
      });
    }

    //console.log (pathIndex);

    _pathIndex = pathIndex;
    _rootItem = rootItem;

    utils.logWithTimestamp('Finished indexing Google Drive metadata for profile \'' + profile.name + '\'. (referencing ' + totalSize.bytesToSize() + ')');
  }

  //---------------------------------------------------------------------------

  function _loadCache(cb) {
    fs.readFile(_cacheFile, 'utf8', function (err, data) {
      if (err) { return cb(err); }
      try {
        _cache = JSON.parse(data);
      } catch (err) {
        return cb(err);
      }
      _buildIndexes();
      cb(null);
    });
  }

  //---------------------------------------------------------------------------

  function _saveCache(cb) {
    utils.mkdir(profile.path, function(err) {
      if (err) { return cb(err); }

      fs.writeFile(_cacheFile, JSON.stringify(_cache, null, '  '), 'utf8', function (err) {
        if (err) { return cb(err); }
        cb(null);
      });
    });
  }
}

//---------------------------------------------------------------------------

module.exports = GoogleDrive;
