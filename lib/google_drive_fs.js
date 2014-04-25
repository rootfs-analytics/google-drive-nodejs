var utils = require('./utils.js');

var f4js = require('fuse4js');

//---------------------------------------------------------------------------

function GoogleDriveFS(profile, googleDrive) {
  var self = this;

  var AUTH_REDIRECT_URL = 'urn:ietf:wg:oauth:2.0:oob';

  var CONFIG_SECTION = 'google_drive_fs';
  var _config = {};

  //self.auth = {};

  /* -------------------------- PUBLIC METHODS -------------------------- */

  self.load = function(cb) {
    profile.getConfigSection(CONFIG_SECTION, function(err, data) {
      if (err) { return cb(err); }
      if (!data || !data.mount_point) {
        return cb(new Error('GoogleDriveFS config section for profile \'' + profile.name + '\' is missing or invalid.'));
      }

      _config = data;

      _startFS();

      cb(null);
    });
  };

  //---------------------------------------------------------------------------

  self.newConfig = function(cb) {
    _config = {};

    utils.get_input('Enter the Mount Point: ', function (mount_point) {
      _config.mount_point = mount_point;

      profile.setConfigSection(CONFIG_SECTION, _config, function (err) {
        if (err) { return cb(err); }

        cb(null);
      });
    });
  };

  /* -------------------------- PRIVATE METHODS -------------------------- */

  function _startFS() {

    var handlers = {
      getattr: _getattr,
      readdir: _readdir,
      open: _open,
      read: _read
    };

    var opts = ['-o','allow_other'];
    var debugFuse = false;

    f4js.start(_config.mount_point, handlers, debugFuse, opts);

    utils.logWithTimestamp('Profile \'' + profile.name + '\' filesystem mounted at \'' + _config.mount_point + '\'');
  }

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
    //stat.blksize = 512;

    if (item.lastViewedByMeDate)
      stat.atime = new Date(item.lastViewedByMeDate);
    if (item.modifiedDate)
      stat.mtime = new Date(item.modifiedDate);

    // http://www.onlineconversion.com/html_chmod_calculator.htm
    switch (item.type) {
      case 'folder':
        stat.size = 4096;   // standard size of a directory
        //stat.blocks = stat.size / stat.blksize;
        stat.mode = 040555; // directory with 555 permissions
        break;

      case 'file':
        stat.size = item.fileSize | 0;
        //stat.blocks = Math.ceil(stat.size / stat.blksize);
        //stat.nlink = 1;
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
    item.childItems.forEach(function(item){
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
