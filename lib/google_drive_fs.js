var utils = require('./utils.js');

var f4js = require('fuse4js');

//---------------------------------------------------------------------------

function GoogleDriveFS(profile, googleDrive, mountpoint) {
  var self = this;

  var AUTH_REDIRECT_URL = 'urn:ietf:wg:oauth:2.0:oob';

  var _mounted = false;

  /* -------------------------- PUBLIC METHODS -------------------------- */

  self.load = function(cb) {
    var handlers = {
      init: _init,
      destroy: _destroy,
      statfs: _statfs,
      getattr: _getattr,
      readdir: _readdir,
      open: _open,
      read: _read
    };

    var opts = ['-o','allow_other'];
    var debugFuse = false;

    f4js.start(mountpoint, handlers, debugFuse, opts);

    cb(null);
  };

  /* -------------------------- PRIVATE METHODS -------------------------- */

  /*
   * Handler for the init() FUSE hook. You can initialize your file system here.
   * cb: a callback to call when you're done initializing. It takes no arguments.
   */
  function _init(cb) {
    _mounted = true;

    profile.info('Filesystem mounted at \'%s\'',mountpoint);
    //console.log("To stop it, type this in another shell: fusermount -u " + options.mountPoint);

    cb();
  }

  //---------------------------------------------------------------------------

  /*
   * Handler for the destroy() FUSE hook. You can perform clean up tasks here.
   * cb: a callback to call when you're done. It takes no arguments.
   */
  function _destroy(cb) {
    if (_mounted) {
      profile.info('Filesystem stopped (mount point: \'%s\')', mountpoint);
    }

    cb();
  }

  //---------------------------------------------------------------------------

  /*
   * Handler for the statfs() FUSE hook.
   * cb: a callback of the form cb(err, stat), where err is the Posix return code
   *     and stat is the result in the form of a statvfs structure (when err === 0)
   */
  function _statfs(cb) {
    // TODO... actually implement this.
    var frsize = 128 * 1024;  // 128 KB
    //var frsize = 512;
    cb(0, {
      bsize: frsize,    // Preferred file system block size
      frsize: frsize,   // Fundamental file system block size
      blocks: Math.ceil(googleDrive.getTotalSize() / frsize),  // Total number of block f_frsize in the file system.
      bfree: 0,         // Total number of free blocks of f_frsize in the file system.
      bavail: 0,        // Total number of available blocks of f_frsize that can be used by users without root access.
      files: 1000000,   // Total number of file nodes in the file system
      ffree: 0,         // Number of free file nodes in the file system.
      favail: 0,        // Number of free file nodes that can be user without root access.
      fsid: 0,          // File system ID.
      flag: 1,          // File system flags: [ST_RDONLY = 1, ST_NOSUID = 2, ST_NODEV = 4]
      namemax: 1000000  // Maximum length of a component name for this file system
    });
  }

  //---------------------------------------------------------------------------

  /*
   * Handler for the getattr() system call.
   * path: the path to the file
   * cb: a callback of the form cb(err, stat), where err is the Posix return code
   *     and stat is the result in the form of a stat structure (when err === 0)
   */
  function _getattr(path, cb) {
    var item = googleDrive.getItemByPath(path);
    if (!item) { return cb(-2); } // -ENOENT

    var stat = {};
    stat.blksize = 128 * 1024;  // 128 KB
    //stat.blksize = 512;

    if (item.lastViewedByMeDate)
      stat.atime = new Date(item.lastViewedByMeDate);
    if (item.modifiedDate)
      stat.mtime = new Date(item.modifiedDate);

    // http://www.onlineconversion.com/html_chmod_calculator.htm
    switch (item.type) {
      case 'folder':
        var childItems = googleDrive.getChildItems(item);
        stat.type = 0040000; // TODO... verify this.
        stat.size = 4096;   // standard size of a directory
        stat.blocks = stat.size / stat.blksize;
        stat.nlink = childItems.length + 2; // TODO... verify this.
        stat.mode = 040555; // directory with 555 permissions
        break;

      case 'file':
        stat.type = 0100000; // TODO... verify this.
        stat.size = item.fileSize | 0;
        stat.blocks = Math.ceil(stat.size / stat.blksize);
        stat.nlink = 1;
        stat.mode = 0100444; // file with 444 permissions
        break;
    }
    cb(0, stat);
  }

  //---------------------------------------------------------------------------

  /*
   * Handler for the readdir() system call.
   * path: the path to the file
   * cb: a callback of the form cb(err, names), where err is the Posix return code
   *     and names is the result in the form of an array of file names (when err === 0).
   */
  function _readdir(path, cb) {
    var item = googleDrive.getItemByPath(path);
    if (!item) { return cb(-2); } // -ENOENT
    if (item.type !== "folder") { return cb(-22); } // -EINVAL

    var children = ['.', '..'];
    var childItems = googleDrive.getChildItems(item);
    childItems.forEach(function(item){
      children.push(item.title);
    });

    cb(0, children);
  }

  //---------------------------------------------------------------------------

  /*
   * Handler for the open() system call.
   * path: the path to the file
   * flags: requested access flags as documented in open(2)
   * cb: a callback of the form cb(err, [fh]), where err is the Posix return code
   *     and fh is an optional numerical file handle, which is passed to subsequent
   *     read(), write(), and release() calls.
   */
  function _open(path, flags, cb) {
    var item = googleDrive.getItemByPath(path);
    if (!item) { return cb(-2); } // -ENOENT

    cb(0); // we don't return a file handle, so fuse4js will initialize it to 0
  }

  //---------------------------------------------------------------------------

  /*
   * Handler for the read() system call.
   * path: the path to the file
   * offset: the file offset to read from
   * len: the number of bytes to read
   * buf: the Buffer to write the data to
   * fh:  the optional file handle originally returned by open(), or 0 if it wasn't
   * cb: a callback of the form cb(err), where err is the Posix return code.
   *     A positive value represents the number of bytes actually read.
   */
  function _read(path, offset, len, buf, fh, cb) {
    var item = googleDrive.getItemByPath(path);
    if (!item) { return cb(-2); } // -ENOENT
    if (item.type !== "file" || !item.downloadUrl) { return cb(-1); } // -EPERM

    googleDrive.getFileBytesByRange(item, offset, len, buf, function(err, len) {
      if (err) { console.error(err); return cb(-16); } // -EBUSY

      cb(len);
    });
  }
}

//---------------------------------------------------------------------------

module.exports = GoogleDriveFS;
