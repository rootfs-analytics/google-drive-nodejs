var utils = require('./utils.js');
var fs = require('fs');
var path = require('path');
var events = require('events');

var googleapis = require('googleapis');

//---------------------------------------------------------------------------

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
  var _totalSize = 0;

  var BLOCK_SIZE = 1048 * 1024; // 1 MB
  var CACHE_CHECK_MIN = 1;      // 1 Minute
  var CACHE_DURATION_MIN = 2;   // 2 Minutes
  var CACHE_READ_AHEAD_BLOCKS = 5;
  var _blockCache = {};

  /* -------------------------- PUBLIC METHODS -------------------------- */

  self.load = function(cb) {
    googleapis.discover('drive', 'v2')
      .withAuthClient(googleAuth.auth)
      .execute(function(err, client) {
        if (err) { return cb(err); }

        self.drive = client.drive;
        profile.info('Retrieved a reference to Google Drive');

        _loadAbout(function(err, about) {
          if (err) { return cb(err); }

          _loadCache(function(err) {
            if (err && (!err.code || err.code !== 'ENOENT')) { return cb(err); }

            _loadChanges(function(err) {
              if (err) { return cb(err); }

              setInterval(_loadChanges, 10*1000);
              setInterval(_releaseOldBlocksFromCache, (CACHE_CHECK_MIN * 60 * 1000));

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

  self.getTotalSize = function() {
    return _totalSize;
  };

  //---------------------------------------------------------------------------

  self.getFileBytesByRange = function(item, offset, len, buf, cb) {
    var start = offset;
    var end = offset + len -1;

    var startBlock = _getBlockNumber(start);
    var endBlock = _getBlockNumber(end);
    profile.silly('getFile', item.id, start, end, len, startBlock, endBlock);

    var blockCount = endBlock-startBlock+1;
    var totalLen = 0;
    for (var i=startBlock; i<=endBlock; i++) {
      _getFileBlock(item, i, function(err, fileBlock) {
        if (err) { return cb(err); }

        fileBlock.lastAccessed = Date.now();

        profile.silly(' gotBlock', item.id, fileBlock.number, fileBlock.start.withCommas(), fileBlock.end.withCommas());

        var targetStart, sourceStart, sourceEnd;
        targetStart = Math.max(fileBlock.start, start) - start;
        sourceStart = Math.max(fileBlock.start, start) - fileBlock.start;
        sourceEnd = (Math.min(fileBlock.end, end) - fileBlock.start) + 1;

        profile.silly(' copyBlock', item.id, fileBlock.number, targetStart.withCommas(), sourceStart.withCommas(), sourceEnd.withCommas());
        fileBlock.data.copy(buf, targetStart, sourceStart, sourceEnd);

        totalLen += ((sourceEnd+1)-sourceStart);
        blockCount--;
        if (blockCount === 0) {
          cb(null, totalLen);
        }
      });
    }

    // Read-ahead cache
    var lastBlock = _getBlockNumber(item.fileSize - 1);
    for (var i = endBlock + 1; i <= Math.min(endBlock + 1 + CACHE_READ_AHEAD_BLOCKS, lastBlock); i++) {
      _getFileBlock(item, i);
    }
  };

  /* -------------------------- PRIVATE METHODS -------------------------- */

  function _releaseOldBlocksFromCache() {
    profile.verbose('Checking file/block cache (' + Object.keys(_blockCache).length + ' files in cache)');

    for (var fileKey in _blockCache) {
      var fileCache = _blockCache[fileKey];

      for (var blockKey in fileCache) {
        var fileBlock = fileCache[blockKey];

        if (fileBlock.lastAccessed < new Date().addMinutes(0 - CACHE_DURATION_MIN)) {
          delete fileCache[blockKey];
          profile.debug('Removing block', blockKey, 'of file', fileKey, 'from cache (' + Object.keys(fileCache).length + ' blocks still in cache)');
        }
      }

      if (Object.keys(fileCache).length === 0) {
        delete _blockCache[fileKey];
        profile.debug('Removing file', fileKey, 'from cache (' + Object.keys(_blockCache).length + ' files still in cache)');
      }
    }
  }

  //---------------------------------------------------------------------------

  function _getBlockNumber(offset) {
    var block = Math.ceil((offset + 1) / BLOCK_SIZE);
    return block;
  }

  //---------------------------------------------------------------------------

  function _getFileBlock(item, block, cb) {

    if (typeof(cb) !== 'function') {
      cb = function(err) {
        if (err) { profile.error(err); }
      };
    }

    var fileCache = _blockCache[item.id];
    if (!fileCache) {
      fileCache = {};
      _blockCache[item.id] = fileCache;
    }

    var fileBlock = fileCache[block];
    if (!fileBlock) {
      fileBlock = {};

      fileBlock.number = block;
      fileBlock.start = (block - 1) * BLOCK_SIZE;
      fileBlock.end = Math.min((block * BLOCK_SIZE), item.fileSize) - 1;

      fileBlock.events = new events.EventEmitter();
      fileBlock.events.setMaxListeners(0);

      fileBlock.lastAccessed = Date.now();

      fileCache[block] = fileBlock;

      _downloadFileBytesByRange(item, fileBlock.start, fileBlock.end, function(err, data) {
        if (err) {
          profile.error(err);

          fileBlock.error = err;
          fileBlock.events.emit('err');
          delete fileBlock.events;

          // remove bad block from cache
          delete fileCache[block];

          return cb(err);
        }

        // TODO... check how much data was actually returned?

        fileBlock.data = data;
        fileBlock.events.emit('done');
        delete fileBlock.events;
        cb(null, fileBlock);
      });
    } else if (fileBlock.error) {
      cb(fileBlock.error);
    } else if (fileBlock.data) {
      cb(null, fileBlock);
    } else {
      if (!fileBlock.events) { return cb(new Error('This shouldn\'t happen')); }

      fileBlock.events
        .once('err', function() {
          cb(fileBlock.error);
        })
        .once('done', function() {
          cb(null, fileBlock);
        });
    }
  }

  //---------------------------------------------------------------------------

  function _downloadFileBytesByRange(item, start, end, cb, dontRetry) {
    var startT = Date.now();
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

          profile.debug('new downloadUrl', item.downloadUrl, resp.downloadUrl);
          item.downloadUrl = resp.downloadUrl;

          _downloadFileBytesByRange(item, start, end, cb, false);
        });
      } else {
        if (response.statusCode !== 206) {
          profile.debug('downloadFileBytesByRange', item.id, 'bytes', start.withCommas(), '-', end.withCommas(), 'of', (item.fileSize-1).withCommas(), '(' + (Date.now() - startT).withCommas() + ' ms.)', '[ERROR]');
          return cb(new Error('Error. HttpStatusCode=' + response.statusCode));
        }

        profile.debug('downloadFileBytesByRange', item.id, 'bytes', start.withCommas(), '-', end.withCommas(), 'of', (item.fileSize-1).withCommas(), '(' + (Date.now() - startT).withCommas() + ' ms.)');
        cb(null, body);
      }
    });
  }

  //---------------------------------------------------------------------------

  function _loadAbout(cb){
    self.drive.about.get().execute(function(err, resp) {
      if (err) { return cb(err); }

      var bytesUsed = new Number(resp.quotaBytesUsed);
      var bytesUsedAggregate = new Number(resp.quotaBytesUsedAggregate);
      var bytesTotal = new Number(resp.quotaBytesTotal);

      profile.info('Hello, %s (used %s / %s of %s)', resp.user.displayName, bytesUsed.bytesToSize(), bytesUsedAggregate.bytesToSize(), bytesTotal.bytesToSize());

      cb(null, resp);
    });
  }

  //---------------------------------------------------------------------------

  function _loadChanges(cb) {
    var MAX_RESULTS = 100;

    if (typeof(cb) !== 'function'){
      cb = function(err) {
        if (err) { profile.error(err); }
      };
    }

    var largestChangeId = _cache.largestChangeId;

    var getPageOfChanges = function(request, changes) {
      var start = Date.now();
      request.execute(function(err, resp) {
        if (err) { return cb(err); }
        if (resp.largestChangeId === _cache.largestChangeId) { return cb(null); }

        profile.verbose('Retrieved a page of Google Drive changes. (%d items, %d ms.)', resp.items.length, Date.now() - start);

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
              _cache.items[change.fileId] = _extractItem(change.file);
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

  function _extractItem(item) {
    var returnVal = {
      id: item.id,
      title: item.title,
      type: item.mimeType === "application/vnd.google-apps.folder" ? "folder" : "file",
      createdDate: item.createdDate,
      modifiedDate: item.modifiedDate,
      lastViewedByMeDate: item.lastViewedByMeDate,
      fileSize: item.fileSize,
      downloadUrl: item.downloadUrl,
      parents: []
    };
    item.parents.forEach(function(parent) {
      returnVal.parents.push({id: parent.id, isRoot: parent.isRoot});
    });
    return returnVal;
  }

  //---------------------------------------------------------------------------

  function _buildIndexes() {
    var idIndex = {};
    var pathIndex = {};
    var rootItem = { type: 'folder', childItems: [] };
    var orphans = { type: 'folder', title: '.orphans', childItems: [] };
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
        if (!item.orphan) {
          profile.debug('orphan:', item.id + ' - ' + item.title);
          item.orphan = true;
        }
        if (orphans.childItems.indexOf(item) === -1)
          orphans.childItems.push(item);
        if (rootItem.childItems.indexOf(orphans) === -1)
          rootItem.childItems.push(orphans);
        pathIndex['/.orphans'] = orphans;
        return ["/.orphans"];
      } else {
        var paths = [];
        item.parents.forEach(function (parent) {
          if (parent.isRoot) {
            if (rootItem.childItems.indexOf(item) === -1)
              rootItem.childItems.push(item);

            paths.push("");
          } else {
            var parentItem = idIndex[parent.id];
            if (!parentItem) {
              profile.warn('parent item not found: ', item.id  + ' - ' + item.title + ' - ' + parent.id);
            } else {
              if (parentItem.childItems.indexOf(item) === -1)
                parentItem.childItems.push(item);

              var parentPaths = getParentPaths(parentItem);
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
      parentPaths.forEach(function(parentPath) {
        var path = parentPath + '/' + item.title;
        pathIndex[path] = item;
      });
    }

    _pathIndex = pathIndex;
    _rootItem = rootItem;
    _totalSize = totalSize;

    profile.info('Finished indexing Google Drive metadata. (referencing %s)', totalSize.bytesToSize());
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
