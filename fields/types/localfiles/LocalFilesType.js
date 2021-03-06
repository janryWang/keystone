/*!
 * Module dependencies.
 */

var fs = require('fs-extra'),
	path = require('path'),
	_ = require('underscore'),
	moment = require('moment'),
	keystone = require('../../../'),
	util = require('util'),
	utils = require('keystone-utils'),
	super_ = require('../Type'),
	async = require('async');

/**
 * localfiles FieldType Constructor
 * @extends Field
 * @api public
 */

function localfiles(list, path, options) {
	
	this._underscoreMethods = ['format', 'uploadFiles'];
	this._fixedSize = 'full';

	// event queues
	this._pre = {
		move: [] // Before file is moved into final destination
	};

	this._post = {
		move: [] // After file is moved into final destination
	};

	// TODO: implement filtering, usage disabled for now
	options.nofilter = true;

	// TODO: implement initial form, usage disabled for now
	if (options.initial) {
		throw new Error('Invalid Configuration\n\n' +
			'localfiles fields (' + list.key + '.' + path + ') do not currently support being used as initial fields.\n');
	}
	
	if (options.overwrite !== false) {
		options.overwrite = true;
	}

	localfiles.super_.call(this, list, path, options);//调用父类Type构造函数,同时上下文切换为当前上下文，
													  // 同时将当前list与当前字段路径和字段配置传给父类构造函数

	// validate destination dir
	if (!options.dest) {
		throw new Error('Invalid Configuration\n\n' +
			'localfiles fields (' + list.key + '.' + path + ') require the "dest" option to be set.');
	}

	// Allow hook into before and after
	if (options.pre && options.pre.move) {
		this._pre.move = this._pre.move.concat(options.pre.move);
	}

	if (options.post && options.post.move) {
		this._post.move = this._post.move.concat(options.post.move);
	}
	
}

/*!
 * Inherit from Field
 */

util.inherits(localfiles, super_);


/**
 * Allows you to add pre middleware after the field has been initialised
 *
 * @api public
 */

localfiles.prototype.pre = function(event, fn) {
	if (!this._pre[event]) {
		throw new Error('localfiles (' + this.list.key + '.' + this.path + ') error: localfiles.pre()\n\n' +
			'Event ' + event + ' is not supported.\n');
	}
	this._pre[event].push(fn);
	return this;
};


/**
 * Allows you to add post middleware after the field has been initialised
 *
 * @api public
 */

localfiles.prototype.post = function(event, fn) {
	if (!this._post[event]) {
		throw new Error('localfiles (' + this.list.key + '.' + this.path + ') error: localfiles.post()\n\n' +
			'Event ' + event + ' is not supported.\n');
	}
	this._post[event].push(fn);
	return this;
};


/**
 * Registers the field on the List's Mongoose Schema.
 * 由父类来调用了
 * @api public
 */

localfiles.prototype.addToSchema = function() {

	var field = this,
		schema = this.list.schema;
	var mongoose = keystone.mongoose;
	
	var paths = this.paths = {
		// fields
		filename:		this._path.append('.filename'),//给当前字段路径添加子路径,只能添加到二维
		path:			  this._path.append('.path'),
		size:			  this._path.append('.size'),
		filetype:		this._path.append('.filetype'),
		// virtuals
		exists:			this._path.append('.exists'),
		upload:			this._path.append('_upload'),
		action:			this._path.append('_action'),
		order: 			this._path.append('_order'),
	};

	var schemaPaths = new mongoose.Schema({//给当前字段添加子模式
		filename:		String,
		path:			String,
		size:			Number,
		filetype:		String
	});
	//相当于生成一个{videos:{xxxxx}}
	schema.add(this._path.addTo({}, [schemaPaths]));//这是mongoose添加数组数据的方法

	var exists = function(item, element_id) {
		var values = item.get(field.path);
		var value;

		if (typeof values === 'undefined' || values.length === 0) {
			return false;
		}

		// if current Field contains any file, it means it exists
		if (typeof element_id === 'undefined') {
			value = values[0];
		} else {
			value = _.findWhere(values, { 'id': element_id });
		}

		if (typeof value === 'undefined') {
			return false;
		}

		var filepaths = value.path,
			filename = value.filename;

		if (!filepaths || !filename) {
			return false;
		}

		return fs.existsSync(path.join(filepaths, filename));
	};

	// The .exists virtual indicates whether a file is stored
	schema.virtual(paths.exists).get(function() {
		return schemaMethods.exists.apply(this);
	});
	//重置当前字段的所有值
	var reset = function(item, element_id) {
		if (typeof element_id === 'undefined') {
			item.set(field.path, []);//根据指定路径将当前文档的属性设置为空数组
		} else {
			var values = item.get(field.path);
			var value = _.findWhere(values, { 'id': element_id });
			if (typeof(value !== 'undefined')) {
				values.splice(values.indexOf(value), 1);
			}
		}
	};
	//document方法
	var schemaMethods = {
		exists: function() {
			return exists(this);
		},
		/**
		 * Resets the value of the field
		 *
		 * @api public
		 */
		reset: function() {
			reset(this);
		},
		/**
		 * Deletes the file from localfiles and resets the field
		 *
		 * @api public
		 */
		remove: function(element_id) {
			if (exists(this, element_id)) {
				var values = this.get(field.path);
				var value = _.findWhere(values, { 'id': element_id });
				if (typeof value !== 'undefined') {
					fs.unlinkSync(path.join(value.path, value.filename));
				}
			}
			reset(this, element_id);
		}
	};
	//将schema方法装箱到field所在的list中的underscoreMethods对象里,同时生成一个与当前list结构一致的dsl操作器
	_.each(schemaMethods, function(fn, key) {
		field.underscoreMethod(key, fn);
	});

	// expose a method on the field to call schema methods
	this.apply = function(item, method) {
		return schemaMethods[method].apply(item, Array.prototype.slice.call(arguments, 2));
	};

	this.bindUnderscoreMethods();
};


/**
 * Formats the field value
 *
 * @api public
 */

localfiles.prototype.format = function(item, i) {
	var files = item.get(this.path);
	if (typeof i === 'undefined') {
		return utils.plural(files.length, '* File');
	}
	var file = files[i];
	if (!file) return '';
	if (this.hasFormatter()) {
		file.href = this.href(file);
		return this.options.format.call(this, item, file);
	}
	return file.filename;
};


/**
 * Detects whether the field has a formatter function
 *
 * @api public
 */

localfiles.prototype.hasFormatter = function() {
	return 'function' === typeof this.options.format;
};


/**
 * Return the public href for a single stored file
 *
 * @api public
 */

localfiles.prototype.href = function(file) {
	if (!file.filename) return '';
	var prefix = this.options.prefix ? this.options.prefix : file.path;
	return path.join(prefix, file.filename);
};


/**
 * Detects whether the field has been modified
 *
 * @api public
 */

localfiles.prototype.isModified = function(item) {
	return item.isModified(this.paths.path);
};


/**
 * Validates that a value for this field has been provided in a data object
 *
 * @api public
 */

localfiles.prototype.validateInput = function(data) {
	// TODO - how should file field input be validated?
	return true;
};


/**
 * Updates the value for this field in the item from a data object
 *
 * @api public
 */

localfiles.prototype.updateItem = function(item, data) {
	// TODO - direct updating of data (not via upload)
};


/**
 * Uploads the file for this field
 *
 * @api public
 */

localfiles.prototype.uploadFiles = function(item, files, update, callback) {
	
	var field = this;
	
	if ('function' === typeof update) {
		callback = update;
		update = false;
	}
	//遍历所有文件，
	async.map(files, function(file, processedFile) {
		
		var prefix = field.options.datePrefix ? moment().format(field.options.datePrefix) + '-' : '',
			filename = prefix + file.name,
			filetype = file.mimetype || file.type;
		
		if (field.options.allowedTypes && !_.contains(field.options.allowedTypes, filetype)) {
			return processedFile(new Error('Unsupported File Type: ' + filetype));
		}

		
		
		var doMove = function(doneMove) {
			
			if ('function' === typeof field.options.filename) {
				filename = field.options.filename(item, filename);
			}
			
			fs.move(file.path, path.join(field.options.dest, filename), { clobber: field.options.overwrite }, function(err) {
				if (err) return doneMove(err);
				
				var fileData = {
					filename: filename,
					path: field.options.dest,
					size: file.size,
					filetype: filetype
				};
				
				if (update) {
					item.get(field.path).push(fileData);
				}
				
				doneMove(null, fileData);
			});
			
		};
		
		async.eachSeries(field._pre.move, function(fn, next) {
			fn(item, file, next);
		}, function(err) {
			if (err) return processedFile(err);
			
			doMove(function(err, fileData) {//移动文件后将文件元数据传出来
				if (err) return processedFile(err);
				
				async.eachSeries(field._post.move, function(fn, next) {//执行中间件
					fn(item, file, fileData, next);
				}, function(err) {
					return processedFile(err, fileData);//如果出错将错误信息和当前文件元数据传出去
				});
			});
		});
		
	}, callback);//此处接受迭代器processedFile调用时传递的err和fileData
	
};


/**
 * Returns a callback that handles a standard form submission for the field
 *
 * Expected form parts are
 * - `field.paths.action` in `req.body` (`clear` or `delete`)意思是从req.body里取出action字段通过该字段来分别映射不同的请求处理器
 * - `field.paths.upload` in `req.files` (uploads the file to localfiles)
 *
 * @api public
 */

localfiles.prototype.getRequestHandler = function(item, req, paths, callback) {

	var field = this;
	
	if (utils.isFunction(paths)) {
		callback = paths;
		paths = field.paths;
	} else if (!paths) {
		paths = field.paths;
	}

	callback = callback || function() {};

	return function() {

		// Order
		if (req.body[paths.order]) {
			var files = item.get(field.path),
				newOrder = req.body[paths.order].split(',');

			files.sort(function(a, b) {
				return (newOrder.indexOf(a._id.toString()) > newOrder.indexOf(b._id.toString())) ? 1 : -1;
			});
		}
		// Removals
		if (req.body && req.body[paths.action]) {
			var actions = req.body[paths.action].split('|');
			actions.forEach(function(action) {
				action = action.split(':');

				var method = action[0],
					ids = action[1];
				
				if (!(/^(remove|reset)$/.test(method)) || !ids) return;
				
				ids.split(',').forEach(function(id) {
					field.apply(item, method, id);
				});

			});
		}

		// Upload new files
		if (req.files) {
			
			var upFiles = req.files[paths.upload];
			if (upFiles) {
				if (!Array.isArray(upFiles)) {
					upFiles = [upFiles];
				}

				if (upFiles.length > 0) {
					upFiles = _.filter(upFiles, function(f) { return typeof f.name !== 'undefined' && f.name.length > 0; });
					
					if (upFiles.length > 0) {
						console.log('uploading files:');
						console.log(upFiles);
						return field.uploadFiles(item, upFiles, true, callback);
					}
				}
			}
		}

		return callback();
	};

};


/**
 * Immediately handles a standard form submission for the field (see `getRequestHandler()`)
 *
 * @api public
 */

localfiles.prototype.handleRequest = function(item, req, paths, callback) {
	this.getRequestHandler(item, req, paths, callback)();
};


/*!
 * Export class
 */

exports = module.exports = localfiles;
