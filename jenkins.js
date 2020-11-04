#!/usr/bin/env node
'use strict';
const path = require('path');
const http = require('http');
const fs = require('fs');

var config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));

const githubUser = config.githubUser,
	githubPass = config.githubPass;

const jenkins = (function(){
	const jenkinsUrl = config.jenkinsUrl,
		jenkinsPort = config.jenkinsPort,
		m2releaseVesrion = 'releaseVersion',
		m2devVesrion = 'developmentVersion',
		m2remoteBranch = 'hudson.plugins.git.BranchSpec',
		m2localBranch = 'hudson.plugins.git.extensions.impl.LocalBranch',
		m2value = 'value="';

	let jobName = path.win32.basename(path.resolve('./'));
	let nameArg = process.argv.filter(arg=>arg.startsWith('-name='));
	if(nameArg.length>0)
	{
		jobName = nameArg[0].replace('-name=','');
		process.argv.splice(process.argv.indexOf(nameArg[0]), 1);
	}
	let options = function(){
		return{
			host: jenkinsUrl,
			port: jenkinsPort,
			method: 'GET'
		};
	};

	var makeRequest = function(options, data){
		return new Promise((resolve, reject)=>{
			const req = http.request(options, res => {
				res.setEncoding('utf8');
				let body = '';
				res.on('data', data => {
					body += data;
				});
				res.on('end', () => {
					if(res.statusCode >= 200 && res.statusCode<300)
						resolve(options.verbose ? {res: res, body: body} : body);
					else
						reject(res.statusMessage);
				});
			}).on('error', (e) => {
				reject(e.message);
			});
			if(typeof data !== 'undefined')
				req.write(data);
			req.end();
		});
	};

	return {
		getConfig: function(){
			let getOptions = options();
			getOptions.path = '/job/'+jobName+'/config.xml';
			return makeRequest(getOptions);
		},
		postConfig: function(config){
			let postOptions = options();
			postOptions.path = '/job/'+jobName+'/config.xml';
			postOptions.method = 'POST';
			return makeRequest(postOptions, config);
		},
		getBranch: function(){
			return this.getConfig().then(config=>{
				let branch = {};
				let start = config.indexOf('>', config.indexOf('\n', config.indexOf(m2remoteBranch))) + 1;
				let end = config.indexOf('<', start);
				branch.remote = config.substring(start, end);
				start = config.indexOf('>', config.indexOf('\n', config.indexOf(m2localBranch))) + 1;
				end = config.indexOf('<', start);
				branch.local = config.substring(start, end);
				return branch;
			});
		},
		setBranch: function(newBranch){
			return this.getConfig().then(config=>{
				let branch = {};
				branch.newBranch = newBranch;
				let start = config.indexOf('>', config.indexOf('\n', config.indexOf(m2remoteBranch))) + 1;
				let end = config.indexOf('<', start);
				branch.remote = config.substring(start, end);
				config = config.slice(0, start) + '*/'+newBranch + config.slice(end);
				start = config.indexOf('>', config.indexOf('\n', config.indexOf(m2localBranch))) + 1;
				end = config.indexOf('<', start);
				branch.local = config.substring(start, end);
				config = config.slice(0, start) + newBranch + config.slice(end);
				return this.postConfig(config);
			});
		},
		getNextVersion: function(){
			let getOptions = options();
			getOptions.path = '/job/'+jobName+'/m2release/';
			return makeRequest(getOptions).then(body=>{
				let nextVersions = {};
				let start = body.indexOf(m2value, body.indexOf(m2releaseVesrion)) + m2value.length;
				let end = body.indexOf('"', start);
				nextVersions.release = body.substring(start, end);
				start = body.indexOf(m2value, body.indexOf(m2devVesrion)) + m2value.length;
				end = body.indexOf('"', start);
				nextVersions.dev = body.substring(start, end);
				return nextVersions;
			});
		},
		build: function(){
			let postOptions = options();
			postOptions.path = '/job/'+jobName+'/build?token='+jobName;
			postOptions.method = 'POST';
			return makeRequest(postOptions);
		},
		release: function(releaseVersion, devVersion){
			let postOptions = options();
			postOptions.path = '/job/'+jobName+'/m2release/submit';
			postOptions.method = 'POST';
			postOptions.headers = {
				'Content-Type': 'application/x-www-form-urlencoded'
			};
			let data = '';
			let formData = {
				'releaseVersion': releaseVersion,
				'developmentVersion': devVersion,
				'specifyScmCredentials': 'on',
				'scmUsername': githubUser,
				'scmPassword': githubPass,
				'scmCommentPrefix': '[maven-release-plugin]',
				'appendHudsonUserName': 'on',
				'scmTag': jobName + '-' + releaseVersion,
				'json': '{"releaseVersion": "'+releaseVersion+'", "developmentVersion": "'+devVersion+'", "isDryRun": false, "specifyScmCredentials": {"scmUsername": "'+githubUser+'", "scmPassword": "'+githubPass+'"}}',
				'Submit': 'Schedule Maven Release Build'
			};
			for(var formEntry in formData)
			{
				if(formData.hasOwnProperty(formEntry))
				{
					data += formEntry + '=' + encodeURIComponent(formData[formEntry]) + '&';
				}
			}
			data.slice(0, -1);
			return makeRequest(postOptions, data);
		},
		pendingLatest: async function() {
			
			try {
				const jobs = await this.getJobs();
				if(!jobs.builds[0].building) {
					console.log('Pending');
					setTimeout(() => {
						this.pendingLatest();
					}, 5000);
				} else {
					const r = await this.console(jobs.builds[0].number);
					console.log(r);
				}
			} catch (e) {
				console.error(e);
			}
		},
		console: function(buildNumber){
			let postOptions = options();
			postOptions.path = '/job/'+jobName+'/'+buildNumber+'/logText/progressiveText';
			postOptions.verbose = true;
			postOptions.method = 'POST';
			postOptions.headers = {
				'Content-Type': 'application/x-www-form-urlencoded'
			};
			return update(0);
			function update(offset)
			{
				let data = 'start='+offset;
				return makeRequest(postOptions, data).then(response=>{
					let body = response.body;
					for(let i = body.indexOf('ERROR', 0); i !== -1; i=body.indexOf('ERROR', i))
					{
						body = body.slice(0, i) + '\x1b[31m' + body.slice(i);
						i = body.indexOf('\n',i);
						body = body.slice(0, i) + '\x1b[0m' + body.slice(i);
					}
					if(body !== '')
						console.log(body.slice(0,-2));
					if(response.res.headers['x-more-data'])
					{
						setTimeout(()=>{
							update(response.res.headers['x-text-size']);
						}, 1000);
					}
					return '';
				});
			}
		},
		//get current queue
		getQueue: function(){
			let getOptions = options();
			getOptions.path = '/queue/api/json?tree=items[actions[causes]{0},id,inQueueSince,params,task[name]]';
			let getExecOptions = options();
			getExecOptions.path = '/computer/api/json?tree=computer[executors[idle,likelyStuck,progress,currentExecutable[timestamp,number,actions[causes]{0},result,displayName,fullDisplayName,building,mavenArtifacts[moduleRecords[mainArtifact[version]]]]]]';
			return makeRequest(getOptions).then(response=>JSON.parse(response));
		},
		//get currently building stuff
		getBuilds: function(){
			let getOptions = options();
			getOptions.path = '/computer/api/json?tree=computer[executors[idle,likelyStuck,progress,currentExecutable[timestamp,number,actions[causes]{0},result,displayName,fullDisplayName,building,mavenArtifacts[moduleRecords[mainArtifact[version]]]]]]';
			return makeRequest(getOptions).then(response=>JSON.parse(response));
		},
		getJobs: function(){
			let getOptions = options();
			getOptions.path = '/job/'+jobName+'/api/json?tree=builds[timestamp,number,actions[causes,lastBuiltRevision[branch[name,SHA1]]],result,displayName,building,mavenArtifacts[moduleRecords[mainArtifact[version]]]]';
			return makeRequest(getOptions).then(response=>JSON.parse(response));
		},
		getQueueStatus: function(){
			return Promise.all([this.getQueue(), this.getBuilds()]).then(responses=>{
				let msg = '';
				let queueItems = responses[0];
				let buildItems = responses[1];
				let queueMsg = queueItems.items.map(item=>item.id+'\t'+(new Date(item.inQueueSince)).toLocaleString()+'\t'+item.task.name+'\t'+(item.actions[0].causes ?item.actions[0].causes[0]._class+'\t':'')+item.params+'\n').join('');
				msg += queueMsg ? 'Items in queue:\n'+queueMsg : 'No items in queue.\n';
				let buildMsg = buildItems.computer.reduce((x, y)=>[...x, ...y.executors], []).map(item=>{
					if(item.currentExecutable)
						return item.currentExecutable.displayName+'\t'+
							(new Date(item.currentExecutable.timestamp)).toLocaleString()+'\t'+
							item.currentExecutable.fullDisplayName+'\t'+
							(item.currentExecutable.actions[0].causes ? item.currentExecutable.actions[0].causes[0]._class : '') + '\n';
				}).join('');
				msg += buildMsg ? 'Items building:\n'+buildMsg : 'No items building.\n';
				return msg;
			},rejected=>{
				console.warn(rejected);
			});
		},
		getStatus: function(){
			return Promise.all([this.getJobs(), this.getQueue()]).then(responses=>{
				let status = responses[0];
				let queue = responses[1];
				return queue.items.map(item=>{
					if(item.task.name===jobName)
						return item.id+'\t\t'+(new Date(item.inQueueSince)).toLocaleString()+'\t'+(item.actions[0].causes ?item.actions[0].causes[0]._class+'\t':'')+item.params+'\n';
				})
					.concat(status.builds.map(build=>{
						let msg = '';
						//columns
						msg += build.displayName+'\t';
						msg += build.building ? '\x1b[33mIN PROGRESS\x1b[m\t': (build.result === 'SUCCESS' ? '\x1b[32m'+build.result : '\x1b[31m'+build.result)+'\x1b[0m\t';
						msg += (new Date(build.timestamp)).toLocaleString()+'\t';
						msg += build.actions.reduce((a,cur)=>{
							if(cur.lastBuiltRevision)
								return cur.lastBuiltRevision.branch[0].name+'\t';
							return a;
						}, '');
						msg += build.actions[0]._class === 'hudson.model.ParametersAction' ?
							(!build.building ? build.result === 'SUCCESS' ? 'Successful' : 'Failed':'') +' release '+(build.mavenArtifacts?build.mavenArtifacts.moduleRecords[0].mainArtifact.version.slice(0,-9) :''):'';
						msg += '\n';
						return msg;
					})).join('');
			});
		},
		stop: function(buildNumber){
			let postOptions = options();
			postOptions.method = 'POST';
			postOptions.path = '/job/'+jobName+'/'+buildNumber+'/stop';
			return makeRequest(postOptions);
		},
		purgeQueue: function(){
			let postOptions = options();
			postOptions.method = 'POST';
			postOptions.path = '/purge-build-queue/purge';
			return makeRequest(postOptions);
		},
		cancel: function(queueNumber){
			let postOptions = options();
			postOptions.method = 'POST';
			postOptions.path = '/queue/cancelItem?id='+queueNumber;
			return makeRequest(postOptions);
		}
	};
})();

(async () => {
	switch (process.argv[2]) {
		case 'build':
			jenkins.build().then(r=>console.log(r)).catch(e=>console.warn(e));
			break;
		case 'stop':
			jenkins.stop(process.argv[3]).then(r=>console.log(r)).catch(e=>console.warn(e));
			break;
		case 'cancel':
			jenkins.cancel(process.argv[3]).then(r=>console.log(r)).catch(e=>console.warn(e));
			break;
		case 'release':
			if(process.argv[3] && process.argv[4])
				jenkins.release(process.argv[3], process.argv[4]).then(r=>console.log(r)).catch(e=>console.warn(e));
			else
				jenkins.getNextVersion().then(r=>{
					console.log(r);
					return jenkins.release(r.release, r.dev);
				}).then(r=>console.log(r)).catch(e=>console.warn(e));
			break;
		case 'status':
			if(process.argv[3])
				jenkins.console(process.argv[3]).then(r=>console.log(r)).catch(e=>console.warn(e));
			else
				Promise.all([jenkins.getBranch(), jenkins.getNextVersion(), jenkins.getStatus()])
					.then(r=>console.log(r.map(o=>typeof o === 'object' ? JSON.stringify(o):o).join('\n')))
					.catch(e=>console.warn(e));
			break;
		case 'latest':
			jenkins.pendingLatest();
			break;
		case 'config':
			jenkins.getConfig().then(r=>console.log(r)).catch(e=>console.warn(e));
			break;
		case 'branch':
			if(process.argv[3])
				jenkins.setBranch(process.argv[3]).then(r=>console.log(r)).catch(e=>console.warn(e));
			else
				jenkins.getBranch().then(r=>console.log(r)).catch(e=>console.warn(e));
			break;
		case 'purge':
			jenkins.purgeQueue().then(r=>console.log(r)).catch(e=>console.warn(e));
			break;
		case 'queue':
			jenkins.getQueueStatus().then(r=>console.log(r)).catch(e=>console.warn(e));
			break;
		case 'help':
		case '-h':
		case '-help':
		case '--help':
			console.log(`OPTIONS:
	'\x1b[31mbuild\x1b[0m': \tschedule jenkins build
	'\x1b[31mstop [n]\x1b[0m': \tstop specific build
	'\x1b[31mcancel [n]\x1b[0m': \tcancel scheduled job
	'\x1b[31mrelease {releaseVersion} {devVersion}\x1b[0m': 
	\tschedule release, if any of optional versions not provided - will use default 
	'\x1b[31mstatus {n}\x1b[0m': \tshow status, if optional num provided - show specific build console log
	'\x1b[31mconfig\x1b[0m': \tget job's config.xml
	'\x1b[31mbranch {name}\x1b[0m': \tget job's remote branch, if optional name provided - set remote branch
	'\x1b[31mpurge\x1b[0m': \tpurge build queue
	'\x1b[31mqueue\x1b[0m': \tlist jobs building and build queue
		`);
			break;
		default:
			Promise.all([jenkins.getQueueStatus(), jenkins.getBranch(), jenkins.getNextVersion(), jenkins.getStatus()])
				.then(r=>console.log(r.map(o=>typeof o === 'object' ? JSON.stringify(o):o).join('\n')))
				.catch(e=>console.warn(e));
	}
})()