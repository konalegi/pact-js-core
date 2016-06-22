'use strict';

var checkTypes = require('check-types'),
	_ = require('underscore'),
	logger = require('./logger'),
	path = require('path'),
	fs = require('fs'),
	cp = require('child_process'),
	q = require('q'),
	unixify = require('unixify'),
	url = require('url');
var isWindows = process.platform === 'win32';

var arch = "";
if (process.platform === 'linux') {
	arch = '-' + process.arch;
}
var packageName = '@pact-foundation/pact-provider-verifier-' + process.platform + arch;
var packagePath = require.resolve(packageName);

// Constructor
function Verifier(providerBaseUrl, pactUrls, providerStatesUrl, providerStatesSetupUrl, pactBrokerUsername, pactBrokerPassword) {
	this.options = {};
	this.options.providerBaseUrl = providerBaseUrl;
	this.options.pactUrls = pactUrls;
	this.options.providerStatesUrl = providerStatesUrl;
	this.options.providerStatesSetupUrl = providerStatesSetupUrl;
	this.options.pactBrokerUsername = pactBrokerUsername;
	this.options.pactBrokerPassword = pactBrokerPassword;
}

Verifier.prototype.verify = function () {
	logger.info("Verifier verify()");
	var deferred = q.defer();
	var stdout = ''; // Store output here in case of error
	var outputHandler = function(data) {
		logger.info(data)
		stdout = stdout + data;
	};
	var envVars = JSON.parse(JSON.stringify(process.env)); // Create copy of environment variables
	// Remove environment variable if there
	// This is a hack to prevent some weird Travelling Ruby behaviour with Gems
	// https://github.com/pact-foundation/pact-mock-service-npm/issues/16
	delete envVars['RUBYGEMS_GEMDEPS'];

	var file,
		opts = {
			cwd: path.resolve(packagePath, '..', 'bin'),
			detached: !isWindows,
			env: envVars
		},
		mapping = {
			'providerBaseUrl': '--provider-base-url',
			'pactUrls': '--pact-urls',
			'providerStatesUrl': '--provider-states-url',
			'providerStatesSetupUrl': '--provider-states-setup-url',
			'pactBrokerUsername': '--broker-username',
			'pactBrokerPassword': '--broker-password'
		};

	var args = _.compact(_.map(mapping, (function (value, key) {
		return this.options[key] ? value + ' ' + (checkTypes.array(this.options[key]) ? this.options[key].join(',') : this.options[key]) : null;
	}).bind(this)));

	var cmd = [packagePath.trim().split(path.sep).pop() + (isWindows ? '.bat' : '')].concat(args).join(' ');

	if (isWindows) {
		file = 'cmd.exe';
		args = ['/s', '/c', cmd];
		opts.windowsVerbatimArguments = true;
	} else {
		cmd = "./" + cmd;
		file = '/bin/sh';
		args = ['-c', cmd];
	}

	this.instance = cp.spawn(file, args, opts);

	this.instance.stdout.setEncoding('utf8');
	this.instance.stdout.on('data', outputHandler);
	this.instance.stderr.setEncoding('utf8');
	this.instance.stderr.on('data', outputHandler);
	this.instance.on('error', logger.error.bind(logger));

	this.instance.once('close', function (code) {
		code == 0 ? deferred.resolve(stdout) : deferred.reject(new Error(stdout));
	});

	logger.info('Created Pact Verifier process with PID: ' + this.instance.pid);
	return deferred.promise.then(function () {
		logger.info('Pact Verification succeeded.');
	}, function (err) {
		return q.reject(err);
	});
};

// Creates a new instance of the pact server with the specified option
module.exports = function (options) {
	options = options || {};
	options.providerBaseUrl = options.providerBaseUrl || '';
	options.pactUrls = options.pactUrls || [];
	options.providerStatesUrl = options.providerStatesUrl || '';
	options.providerStatesSetupUrl = options.providerStatesSetupUrl || '';

	options.pactUrls = _.map(options.pactUrls, function (uri) {
		// only check local files
		if (!/https?:/.test(url.parse(uri).protocol)) { // If it's not a URL, check if file is available
			try {
				fs.statSync(path.normalize(uri)).isFile();

				// Unixify the paths. Pact in multiple places uses URI and matching and
				// hasn't really taken Windows into account. This is much easier, albeit
				// might be a problem on non root-drives
				// options.pactUrls.push(uri);
				return unixify(uri);
			} catch (e) {
				throw new Error('Pact file: "' + uri + '" doesn\'t exist');
			}
		}
			// HTTP paths are OK
		return uri;
	});

	checkTypes.assert.nonEmptyString(options.providerBaseUrl, 'Must provide the --provider-base-url argument');
	checkTypes.assert.not.emptyArray(options.pactUrls, 'Must provide the --pact-urls argument');

	if (options.providerStatesSetupUrl) {
		checkTypes.assert.string(options.providerStatesSetupUrl);
	}

	if (options.providerStatesUrl) {
		checkTypes.assert.string(options.providerStatesUrl);
	}

	if (options.pactBrokerUsername) {
		checkTypes.assert.string(options.pactBrokerUsername);
	}

	if (options.pactBrokerPassword) {
		checkTypes.assert.string(options.pactBrokerPassword);
	}

	if ((options.providerStatesUrl && !options.providerStatesSetupUrl) || (options.providerStatesSetupUrl && !options.providerStatesUrl)) {
		throw new Error('Must provide both or none of --provider-states-url and --provider-states-setup-url.');
	}

	if (options.pactUrls) {
		checkTypes.assert.array.of.string(options.pactUrls);
	}

	if (options.providerBaseUrl) {
		checkTypes.assert.string(options.providerBaseUrl);
	}

	return new Verifier(options.providerBaseUrl, options.pactUrls, options.providerStatesUrl, options.providerStatesSetupUrl, options.pactBrokerUsername, options.pactBrokerPassword);
};
