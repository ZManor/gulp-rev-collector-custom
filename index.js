'use strict';
var _            = require('underscore');
var PluginError  = require('plugin-error');
var Vinyl        = require('vinyl');
var through      = require('through2');
var path         = require('path');
var fs           = require('fs');

var PLUGIN_NAME  = 'gulp-rev-collector';

var defaults = {
    revSuffix: '-[0-9a-f]{8,10}-?',
    extMap: {
        '.scss': '.css',
        '.less': '.css',
        '.jsx': '.js'
    },
    baseDir: process.cwd()
};

function _getManifestData(file, opts) {
    var data;
    var ext = path.extname(file.path);
    if (ext === '.json') {
        var json = {};
        try {
            var content = file.contents.toString('utf8');
            if (content) {
                json = JSON.parse(content);
            }
        } catch (x) {
            this.emit('error', new PluginError(PLUGIN_NAME,  x));
            return;
        }
        if (_.isObject(json)) {
            var isRev = 1;
            Object.keys(json).forEach(function (key) {
                if (!_.isString(json[key])) {
                    isRev = 0;
                    return;
                }
                var cleanReplacement =  path.basename(json[key]).replace(new RegExp( opts.revSuffix ), '' );
                if (!~[
                        path.basename(key),
                        _mapExtnames(path.basename(key), opts)
                    ].indexOf(cleanReplacement)
                ) {
                    isRev = 0;
                }
            });

            if (isRev) {
                data = json;
            }
        }

    }
    return data;
}

// Issue #30 extnames normalisation
function _mapExtnames(filename, opts) {
    var fileExt = path.extname(filename);
    Object.keys(opts.extMap).forEach(function (ext) {
        if (fileExt === ext) {
            filename = filename.replace(new RegExp( '\\' + ext + '$' ), opts.extMap[ext]);
        }
    });
    return filename;
}

function escPathPattern(pattern) {
    return pattern.replace(/[\-\[\]\{\}\(\)\*\+\?\.\^\$\|\/\\]/g, "\\$&");
}

function closeDirBySep(dirname) {
    return dirname + (!dirname || new RegExp( escPathPattern('/') + '$' ).test(dirname) ? '' : '/');
}

function revCollector(opts) {
    opts = _.defaults((opts || {}), defaults);

    var manifest  = {};
    var mutables = [];
    return through.obj(function (file, enc, cb) {
        if (!file.isNull()) {
            var mData = _getManifestData.call(this, file, opts);
            if (mData) {
                _.extend( manifest, mData );
            } else {
                mutables.push(file);
            }
        }
        cb();
    }, function (cb) {
        var changes = [];
        var dirReplacements = [];
        if ( _.isObject(opts.dirReplacements) ) {
            Object.keys(opts.dirReplacements).forEach(function (srcDirname) {
                dirReplacements.push({
                    dirRX:  escPathPattern( closeDirBySep(srcDirname) ),
                    dirRpl: opts.dirReplacements[srcDirname]
                });
            });
        }

        if (opts.collectedManifest) {
            this.push(
                new Vinyl({
                    path: opts.collectedManifest,
                    contents: new Buffer(JSON.stringify(manifest, null, "\t"))
                })
            );
        }

        for (var key in manifest) {
            var patterns = [ escPathPattern(key) ];
            if (opts.replaceReved) {
                var patternExt = path.extname(key);
                if (patternExt in opts.extMap) {
                    patternExt = '(' + escPathPattern(patternExt) + '|' + escPathPattern(opts.extMap[patternExt]) + ')';
                } else {
                    patternExt = escPathPattern(patternExt);
                }
                patterns.push( escPathPattern( (path.dirname(key) === '.' ? '' : closeDirBySep(path.dirname(key)) ) )
                            + path.basename(key, path.extname(key))
                                .split('.')
                                .map(function(part){
                                    return escPathPattern(part) + '(' + opts.revSuffix + ')?';
                                })
                                .join('\\.')
                            + patternExt
                        );
            }

            if ( dirReplacements.length ) {
                dirReplacements.forEach(function (dirRule) {
                    patterns.forEach(function (pattern) {
                        changes.push({
                            regexp: new RegExp(  dirRule.dirRX + pattern, 'g' ),
                            patternLength: (dirRule.dirRX + pattern).length,
                            replacement: _.isFunction(dirRule.dirRpl)
                                            ? dirRule.dirRpl(manifest[key])
                                            : closeDirBySep(dirRule.dirRpl) + manifest[key]
                        });
                    });
                });
            } else {
                patterns.forEach(function (pattern) {
                    // without dirReplacements we must leave asset filenames with prefixes in its original state
                    var prefixDelim = '([\/\\\\\'"';
                    // if dir part in pattern exists, all exsotoic symbols should be correct processed using dirReplacements
                    if (/[\\\\\/]/.test(pattern)) {
                        prefixDelim += '\(=';
                    } else {
                        if (!/[\(\)]/.test(pattern)) {
                            prefixDelim += '\(';
                        }
                        if (!~pattern.indexOf('=')) {
                            prefixDelim += '=';
                        }
                    }
                    prefixDelim += '])';
                    changes.push({
                        regexp: new RegExp( prefixDelim + pattern, 'g' ),
                        patternLength: pattern.length,
                        replacement: '$1' + manifest[key]
                    });
                });
            }
        }

        // Replace longer patterns first
        // e.g. match `script.js.map` before `script.js`
        changes.sort(
            function(a, b) {
                return b.patternLength - a.patternLength;
            }
        );
        mutables.forEach(function (file){
            if (!file.isNull()) {
                //var src = file.contents.toString('utf8');
                var src = normaliseUri(file, opts.baseDir);
                changes.forEach(function (r) {
                    src = src.replace(r.regexp, r.replacement);
                });
                file.contents = new Buffer(src);
            }
            this.push(file);
        }, this);

        cb();
    });
}

/* 优化文件引用的相对路径 */
function normaliseUri(file, baseDir) {
    var filedir = path.dirname(file.path);
    var content = file.contents.toString('utf8');
    var regRelps = {};
    baseDir = path.join(process.cwd(), baseDir);
    
    // 解析[href=""]属性
    var hrefs = content.match(/href=[\"\'].+[\"\']/g);
    if (hrefs) {
        hrefs.forEach(function (attr){
            var uri = attr.substring(6, attr.length-1);
            var nUri = getExistPath(uri, filedir, baseDir);
            if (nUri){
                regRelps[uri] = getExistPath(uri, filedir, baseDir);
            }
        });
    }

    // 解析[src=""]属性
    var srcs = content.match(/src=[\"\'].+[\"\']/g);
    if (srcs) {
        srcs.forEach(function (attr){
            var uri = attr.substring(5, attr.length-1);
            var nUri = getExistPath(uri, filedir, baseDir);
            if (nUri){
                regRelps[uri] = getExistPath(uri, filedir, baseDir);
            }
        });
    }

    // 解析[url("")]属性
    var srcs = content.match(/url\([\"\'].+[\"\']\)/g);
    if (srcs) {
        srcs.forEach(function (attr){
            var uri = attr.substring(5, attr.length-2);
            var nUri = getExistPath(uri, filedir, baseDir);
            if (nUri){
                regRelps[uri] = getExistPath(uri, filedir, baseDir);
            }
        });
    }

    for (var uri in regRelps) {
        content = content.replace(uri, regRelps[uri]);
    }
    return content;
}

function getExistPath(uri, curDir, baseDir){
    var ret = null;
    if (uri.substr(0, 2) == '..') {
        // 以当前文件路径为根
        var nUri = path.normalize(path.join(curDir, uri));
        if (fs.existsSync(nUri)) {
            ret = nUri.replace(baseDir, '/').replace(/\\/g,'/');
        }
    } else if (uri.charAt(0) != '.') {
        // 以项目根路径为根
        var nUri = path.normalize(path.join(baseDir, uri));
        if (fs.existsSync(nUri)) {
            ret = nUri.replace(baseDir, '/').replace(/\\/g,'/');
        }
    } else {
        // 以上情况都有可能
        var nUri = path.normalize(path.join(curDir, uri));
        if (fs.existsSync(nUri)) {
            ret = nUri.replace(baseDir, '/').replace(/\\/g,'/');
        } else {
            nUri = path.normalize(path.join(baseDir, uri));
            if (fs.existsSync(nUri)) {
                ret = nUri.replace(baseDir, '/').replace(/\\/g,'/');
            }
        }
    }
    return ret;
}

module.exports = revCollector;
