/**
  Presemo 4 - Live Participation Engine
  Copyright (C) 2013-2015 Screen.io

  This program is free software: you can redistribute it and/or modify
  it under the terms of the GNU Affero General Public License as
  published by the Free Software Foundation, either version 3 of the
  License, or (at your option) any later version.

  This program is distributed in the hope that it will be useful,
  but WITHOUT ANY WARRANTY; without even the implied warranty of
  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
  GNU Affero General Public License for more details.

  You should have received a copy of the GNU Affero General Public License
  along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/

/**
 * Scatter block
 */

var BLOCKTYPE = require('path').basename(__dirname);

var debug = require('debug')('io:' + BLOCKTYPE); debug('module loading');
var console = require('../../lib/Logger')('io:' + BLOCKTYPE);

//var backend = require('..');
var SiteConfig = require('../../lib/SiteConfig');
var BlockBuilder = require('../../lib/BlockBuilderSync');
var throttle = require('../../lib/utils/throttle');
var DataStore = require('../../lib/DataStore');
var db = DataStore.namespace(BLOCKTYPE);
var rpc = require('../../lib/rpc');
//var ChannelStore = require('../../lib/ChannelStore');
//var BlockStore = require('../../lib/BlockStore');

function defaults(obj, props) {
  if (typeof props === 'function') {
    props = props();
  }
  for (var key in props) {
    if (obj[key] === undefined) {
      obj[key] = props[key];
    }
  }
}

/**
 * Exports a block serverside instance constructor
 */

exports = module.exports = Block;

/**
 * Static methods for the framework
 */

exports.__buildFrontendAssets = function(done) {
  // Think whether to use
  // SiteConfig.AVAILABLE_CHANNELTYPES or
  // block's SUPPORTED_CHANNELTYPES here
  // TODO refactor api
  BlockBuilder(BLOCKTYPE, done);
};

exports.__getFrontendAssetUrlsForChannel = function(channel) {
  debug('getFrontendAssetUrlsForChannel called');
  return {
    js: [{
      url: '/' + SiteConfig.SITEROUTE + '/assets/' + BLOCKTYPE + '/' + BLOCKTYPE + '-' + SiteConfig.SITELANG + '-' + channel.type + '.min.js.gz_'
    }]
  };
};

exports.__getPackageInfo = function() {
  // Size info etc
  return {};
};

/**
 * Block constructor
 */

function Block(options) {
  if (!(this instanceof Block)) return new Block(options);
  options = options || {};
  this.id = options.id || db.getUniqueId();
  this.type = BLOCKTYPE;
  this.frontends = options.frontends || {};
  defaults(this.frontends, {
    active: true,
    selected: false,
    visible: false,
    heading: '',
    description: '',
    showMeanVar: false,
    //showStdDev: false,
    firstOptionValue: null,
    lastOptionValue: null,
    realtime: false
  });
  this.options = options.options || [];
  this.participants = options.participants || {};
  this.participantCount = options.participantCount || 0;
  this.resultMeta = options.resultMeta || {};
  this.results = options.results || []; // properly new Array(this.options.length)
  this.voters = options.voters || {};

  this.channels = {};
  this.rpc = rpc.block;

  // TODO granular, throttled save
  if (!this.saveThrottled) {
    this.saveThrottled = throttle(this.save, 5000); // every five seconds max
  }
}
// TODO more granular save functions
Block.prototype.save = function() {
  db.set(this.id, {
    id: this.id,
    frontends: this.frontends,
    options: this.options,
    participants: this.participants,
    participantCount: this.participantCount,
    resultMeta: this.resultMeta,
    results: this.results,
    voters: this.voters
  });
  return this;
}
Block.__loadBlock = function(id) {
  var config = db.get(id);
  if (!config) return;
  return new Block(config);
};
Block.__createBlock = function(configIn) {
  // Implement if creation from config.json needed
};
Block.__dangerouslyCreateBlock = function(dangerousFormObject) {
  debug(
    '__dangerouslyCreateBlock() called with dangerousFormObject: %j',
    dangerousFormObject
  );
  var blockConfig = {};
  blockConfig.id = db.getUniqueId();

  blockConfig.frontends = {};
  if (typeof dangerousFormObject.heading !== 'string') {
    dangerousFormObject.heading = '';
  }
  blockConfig.frontends.heading = trimWhitespace(dangerousFormObject.heading).substring(0, 500);

  if (typeof dangerousFormObject.description !== 'string') {
    dangerousFormObject.description = '';
  }
  blockConfig.frontends.description = trimWhitespace(dangerousFormObject.description).substring(0, 2000);

  if (!Array.isArray(dangerousFormObject.options)) {
    return;
  }
  //if (dangerousFormObject.options.length === 0 || dangerousFormObject.options.length > 40) {
  if (dangerousFormObject.options.length === 0) {
    // Create a special default scatter plot
  }
  if (dangerousFormObject.options.length === 1) {
    return;
  }
  if (dangerousFormObject.options.length > 2) {
    // Too many, will use just the first two
    dangerousFormObject.options = dangerousFormObject.options.slice(0, 2);
    // Options is an array parsed from json transport, so no malicious 'slice' prop etc possible.
  }

  var optionsValid = dangerousFormObject.options.every(function(option) {
    return (typeof option === 'string');
  });
  if (!optionsValid) {
    return;
  }
  blockConfig.options = dangerousFormObject.options.map(function(option) {
    // TODO Could result in empty options if consists of whitespace
    return trimWhitespace(option).substring(0, 200);
  });
  if (dangerousFormObject.optionsConfig != null) {
    if(isFinite(parseFloat(dangerousFormObject.optionsConfig.firstOptionValue))) {
      blockConfig.frontends.firstOptionValue = parseFloat(dangerousFormObject.optionsConfig.firstOptionValue)
    }
    if(isFinite(parseFloat(dangerousFormObject.optionsConfig.lastOptionValue))) {
      blockConfig.frontends.lastOptionValue = parseFloat(dangerousFormObject.optionsConfig.lastOptionValue)
    }
  }

  debug('validated properties: %j', blockConfig);

  var block = new Block(blockConfig);
  block.save();

  console.info({
    blockId: blockConfig.id,
    heading: blockConfig.frontends.heading,
    description: blockConfig.frontends.description,
    options: blockConfig.options
  }, 'createScatterBlock');

  return block;
};

Block.prototype.__injectChannel = function(channel) {
  //if (!supports(channel.type)) throw new Error('unsupported channeltype ' + channel.type);
  // TODO ensure that getFrontendConfig can give right kind of properties
  this.channels[channel.id] = channel;
};

Block.prototype.__getBlockFrontendConfigForChannelUser = function(channel, user) {
  var staticConfig = {
    id: this.id,
    type: this.type,
    visible: this.frontends.visible,
    selected: this.frontends.selected,
    active: this.frontends.active,
    heading: this.frontends.heading,
    description: this.frontends.description,
    options: this.options,
    realtime: this.frontends.realtime
  };

  if (channel.type !== 'web') {
    //staticConfig.smallMsgsOnScreen = this.frontends.smallMsgsOnScreen;
    //staticConfig.hideMsgsOnScreen = this.frontends.hideMsgsOnScreen;
    //staticConfig.hidePicksOnScreen = this.frontends.hidePicksOnScreen;
    staticConfig.resultMeta = this.resultMeta; // Before results for now!
    staticConfig.results = this.results; // Results changed event happens only now!

    staticConfig.voters = this.voters; // Scatterplot status

    if (this.frontends.firstOptionValue != null) {
      staticConfig.firstOptionValue = this.frontends.firstOptionValue;
      staticConfig.lastOptionValue = this.frontends.lastOptionValue;
    }
    staticConfig.showMeanVar = this.frontends.showMeanVar;
  }
  if (channel.type === 'control') {
    staticConfig.participantCount = this.participantCount;
  }

  return staticConfig;
};

Block.prototype.__getFrontendDataForChannel = function(channel, httpRequest) {
  return '';
};

Block.prototype.__setVisible = function(visible) {
  visible = !!visible;
  if (this.frontends.visible !== visible) {
    this.frontends.visible = visible;
    //this.saveFrontends();
    this.save();
    this.rpc('$setConfig', {visible: this.frontends.visible});
  }
  return this;
};

Block.prototype.__setSelected = function(selected) {
  selected = !!selected;
  if (this.frontends.selected !== selected) {
    this.frontends.selected = selected;
    //this.saveFrontends();
    this.save();
    for (var channelId in this.channels) {
      if (this.channels[channelId].type !== 'web') {
        this.rpc(channelId + ':$setConfig', {selected: this.frontends.selected});
      }
    }
    //this.rpc('$setConfig', {selected: this.frontends.selected});
  }
  return this;
};

Block.prototype.__getBlockReport = function(timeDiff) {
  var out = '';
  out += this.frontends.heading + '\n\n';
  if (this.frontends.description) {
    out += this.frontends.description + '\n\n';
  }
  if (SiteConfig.SITELANG === 'fi') {
    out += this.participantCount + ' osallistujaa\n\n';
  } else {
    out += this.participantCount + ' participants\n\n';
  }

  var options = this.options;
  var results = this.results;

  // Only two options taken into account for scatterplot
  var option = options[0] || 'Axis 1';
  out += option + '\n';
  for (var userId in this.voters) {
    out += this.voters[userId].vote1 + ', '; // relies on decimals being points
  }

  out += '\n';
  option = options[1] || 'Axis 2';
  out += option + '\n';
  for (var userId in this.voters) {
    out += this.voters[userId].vote2 + ', ';
  }
  out += '\n';

  return out;
};

Block.prototype.__getBlockReportCSV = function(timeDiff) {
  var out = '';

  if (SiteConfig.SITELANG === 'fi') {
    out += 'SIRONTA\n';
  } else {
    out += 'SCATTER\n';
  }

  out += this.frontends.heading + '\n';
  if (this.frontends.description) {
    out += this.frontends.description + '\n';
  }
  if (SiteConfig.SITELANG === 'fi') {
    out += this.participantCount + ' osallistujaa\n';
  } else {
    out += this.participantCount + ' participants\n';
  }

  var options = this.options;
  var results = this.results;

  // Only two options taken into account for scatterplot
  var option = options[0] || 'Axis 1';
  out += option + '\t';
  option = options[1] || 'Axis 2';
  out += option + '\n';

  for (var userId in this.voters) {
    out += this.voters[userId].vote1 + '\t';
    out += this.voters[userId].vote2 + '\n';
  }

  //req.reply(null, csv);

  return out;
};

// Or routed via core?
// TODO disciplined way of resetting the block contents
Block.prototype.$clear = function(req) {
  if (req.channel.type !== 'control') return;
  // If there are throttled functions firing later, they should be
  // ok as they operate on then current data.

  this.participants = {};
  this.participantCount = 0;
  this.results = [];
  this.resultMeta = {};
  this.voters = {};
  this.save();
  this.rpc('$clear');
  // Or use this.sendParticipantCount();
  this.rpc('control:$setConfig', {participantCount: this.participantCount});

  for (var channelId in this.channels) {
    if (this.channels[channelId].type !== 'web') {
      this.rpc(channelId + ':$setConfig', {resultMeta: this.resultMeta, results: this.results, voters: this.voters});
    }
  }

  console.info({
    userId: req.user.id,
    channelId: req.channel.id,
    blockId: this.id
  }, '$clear');
}

Block.prototype.$active = function(req, active) {
  if (req.channel.type !== 'control') return;
  active = !!active;
  if (this.frontends.active !== active) {
    this.frontends.active = active;
    //this.saveFrontends();
    this.save();
    this.rpc('$setConfig', {active: this.frontends.active});
    console.info({
      userId: req.user.id,
      channelId: req.channel.id,
      blockId: this.id,
      active: this.frontends.active
    }, '$active');
  }
};

Block.prototype.$showMeanVar = function(req, showMeanVar) {
  if (req.channel.type !== 'control') return;
  showMeanVar = !!showMeanVar;
  if (this.frontends.showMeanVar !== showMeanVar) {
    this.frontends.showMeanVar = showMeanVar;
    //this.saveFrontends();
    this.save();
    this.rpc('$setConfig', {showMeanVar: this.frontends.showMeanVar});
    console.info({
      userId: req.user.id,
      channelId: req.channel.id,
      blockId: this.id,
      showMeanVar: this.frontends.showMeanVar
    }, '$showMeanVar');
  }
};

Block.prototype.$realtime = function(req, realtime) {
  if (req.channel.type !== 'control') return;
  realtime = !!realtime;
  if (this.frontends.realtime !== realtime) {
    this.frontends.realtime = realtime;
    //this.saveFrontends();
    this.save();
    this.rpc('$setConfig', {realtime: this.frontends.realtime});
    console.info({
      userId: req.user.id,
      channelId: req.channel.id,
      blockId: this.id,
      realtime: this.frontends.realtime
    }, '$realtime');
  }
};

Block.prototype.$heading = function(req, heading) {
  if (req.channel.type !== 'control') return;
  if (typeof heading !== 'string') return;
  if (this.frontends.heading !== heading) {
    this.frontends.heading = trimWhitespace(heading).substring(0, 500);
    //this.saveFrontends();
    this.save();
    this.rpc('$setConfig', {heading: this.frontends.heading});
    console.info({
      userId: req.user.id,
      channelId: req.channel.id,
      blockId: this.id,
      heading: this.frontends.heading
    }, '$heading');
  }
};
Block.prototype.$description = function(req, description) {
  if (req.channel.type !== 'control') return;
  if (typeof description !== 'string') return;
  if (this.frontends.description !== description) {
    this.frontends.description = trimWhitespace(description).substring(0, 2000);
    //this.saveFrontends();
    this.save();
    this.rpc('$setConfig', {description: this.frontends.description});
    console.info({
      userId: req.user.id,
      channelId: req.channel.id,
      blockId: this.id,
      description: this.frontends.description
    }, '$description');
  }
};

function trimWhitespace(str) {
  str = str.replace(/\s/g, ' '); // convert all non-printable chars to a space
  str = str.replace(/^\s+|\s+$/g, ''); // begin enimd
  str = str.replace(/\s\s+/g, ' '); // middle
  return str;
}

Block.prototype.$vote = function(req, optionId) {
  return; // disabled

  if (typeof optionId !== 'number' &&
      typeof optionId !== 'string') {
    return;
  }

  // Cast to integer
  optionId = optionId|0;
  if (optionId < 0 || optionId >= this.options.length) return;

  //var option = this.options[optionId];

  var userId = req.channel.id + ':' + req.user.id;

  this.updateParticipantCount(userId);
  // TODO combine above and below
  if (!this.voters[userId]) {
    // Not voted yet, could check here
    this.voters[userId] = { vote: 0 }; // Default to first option
    // TODO later multiple options

    // Activity logging
    if (req.user.log) {
      req.user.log('newVote');
    }
  }

  var voter = this.voters[userId];

  voter.vote = optionId;

  if (!this.calcRankingThrottled) {
    this.calcRankingThrottled = throttle(this.calcRanking, 100); // ten times per second max
  }
  this.calcRankingThrottled();

  console.info({
    userId: req.user.id,
    channelId: req.channel.id,
    blockId: this.id,
    optionId: optionId
  }, '$vote');

  // TODO could give feedback
};

// Hopefully not too slow or memory hog (creates copies)
Block.prototype.calcRanking = function() {
  return; // Disabled

  var results = [];
  for (var i = 0; i < this.options.length; i++) {
    // TODO option is a string, not an object with .text property!
    results[i] = {id: i, text: this.options[i].text, points: 0};
  }

  // Calculate all results again and again
  var voterCount = 0;
  for (var voterKey in this.voters) {
    voterCount++;
    var vote = this.voters[voterKey].vote;
    results[vote].points++;
  }

  var resultMeta = {
    pollMean: undefined,
    pollStdDev: undefined
  };

  if (this.frontends.firstOptionValue !== null) {

    if (voterCount && results.length) {
      var pollIndexSum = 0;
      for (var i = 0; i < results.length; i++) {
        var votes = results[i].points;
        pollIndexSum += votes * i;
      }
      var pollIndexMean = pollIndexSum / voterCount;

      var pollIndexSquaredSum = 0;
      for (var i = 0; i < results.length; i++) {
        var votes = results[i].points;
        var pollIndexFromMean = (i - pollIndexMean);
        pollIndexSquaredSum += pollIndexFromMean * pollIndexFromMean * votes;
      }
      var pollIndexSquaredMean = pollIndexSquaredSum / voterCount;
      var pollIndexStdDev = Math.sqrt(pollIndexSquaredMean);

      var pollIndexMin = 0;
      var pollIndexMax = results.length - 1;
      var pollMin = this.frontends.firstOptionValue;
      var pollMax = this.frontends.lastOptionValue;

      resultMeta.pollMean = pollMin + pollIndexMean / pollIndexMax * (pollMax - pollMin);
      resultMeta.pollMean = Math.round(resultMeta.pollMean*100)/100

      resultMeta.pollStdDev = pollIndexStdDev / pollIndexMax * (pollMax - pollMin);
      resultMeta.pollStdDev = Math.round(resultMeta.pollStdDev*100)/100;
    }
  }

  this.results = results;
  this.resultMeta = resultMeta;

  // TODO granular, throttled save
  this.saveThrottled();

  //this.rpc('web:$rankingIn', options); // could be slower here, or commented away
  //this.rpc('screen:$pollingIn', results); // could be faster here
  //this.rpc('stage:$pollingIn', results);
  //this.rpc('control:$pollingIn', results);

  this.rpc('screen:$setConfig', {resultMeta: resultMeta, results: results}); // could be faster here
  this.rpc('stage:$setConfig', {resultMeta: resultMeta, results: results});
  this.rpc('control:$setConfig', {resultMeta: resultMeta, results: results});
};

Block.prototype.updateParticipantCount = function(userId) {
  if (this.participants[userId]) return;

  this.participants[userId] = true; // TODO later more info
  this.participantCount++; // Or calc deferred with Object.keys(this.participants).length

  // TODO granular, throttled save
  this.saveThrottled();

  if (!this.sendParticipantCountThrottled) {
    this.sendParticipantCountThrottled = throttle(this.sendParticipantCount, 1000);
  }
  this.sendParticipantCountThrottled();

  //this.emit('change:data:participantCount', this.participantCount);

  console.info({
    blockId: this.id,
    participantCount: this.participantCount
  }, 'scatterParticipantCount');

};

Block.prototype.sendParticipantCount = function() {
  // TODO will send only to control for now
  this.rpc('control:$setConfig', {participantCount: this.participantCount});
}

// For scatter specifically
Block.prototype.$sendAnswers = function(req, optionObj) {
  if (!optionObj || typeof optionObj != 'object') {
    return;
  }

  if (this.options.length !== 2) {
    // Special default block

    if (typeof optionObj.q1 !== 'number' &&
        typeof optionObj.q1 !== 'string') {
      return;
    }
    if (typeof optionObj.q2 !== 'number' &&
        typeof optionObj.q2 !== 'string') {
      return;
    }
    if (typeof optionObj.q3 !== 'number' &&
        typeof optionObj.q3 !== 'string') {
      return;
    }
    if (typeof optionObj.q4 !== 'number' &&
        typeof optionObj.q4 !== 'string') {
      return;
    }

    var q1 = +optionObj.q1;
    if (isNaN(q1) || q1 < 0 || q1 > 100) { // takes care of Infinity
      return;
    }
    var q2 = +optionObj.q2;
    if (isNaN(q2) || q2 < 0 || q2 > 100) {
      return;
    }

    var q3 = +optionObj.q3;
    if (isNaN(q3) || q3 < 0 || q3 > 100) {
      return;
    }
    var q4 = +optionObj.q4;
    if (isNaN(q4) || q4 < 0 || q4 > 100) {
      return;
    }

    var vote1 = (q1+q2)/2;
    var vote2 = (q3+q4)/2;

  } else {

    if (typeof optionObj.q1 !== 'number' &&
        typeof optionObj.q1 !== 'string') {
      return;
    }
    if (typeof optionObj.q2 !== 'number' &&
        typeof optionObj.q2 !== 'string') {
      return;
    }
    var vote1 = +optionObj.q1;
    if (isNaN(vote1) || vote1 < 0 || vote1 > 100) { // takes care of Infinity
      return;
    }
    var vote2 = +optionObj.q2;
    if (isNaN(vote2) || vote2 < 0 || vote2 > 100) {
      return;
    }

  }

  var userId = req.channel.id + ':' + req.user.id;

  this.updateParticipantCount(userId);
  // TODO combine above and below
  if (!this.voters[userId]) {
    // Not voted yet, could check here
    //this.voters[userId] = { vote: 0 }; // Default to first option
    this.voters[userId] = { vote1: 50, vote2: 50 }; // Default to middle
    // TODO later multiple options

    // Activity logging
    if (req.user.log) {
      //req.user.log('newVote');
    }
  }

  var voter = this.voters[userId];

  //voter.vote = optionId;
  // TODO change to array tuple
  voter.vote1 = vote1;
  voter.vote2 = vote2;

  if (!this.sendScatterThrottled) {
    this.sendScatterThrottled = throttle(this.sendScatter, 100); // ten times per second max
  }
  this.sendScatterThrottled();

  console.info({
    userId: req.user.id,
    channelId: req.channel.id,
    blockId: this.id,
    vote1: vote1,
    vote2: vote2
    //optionId: optionId
  }, '$sendAnswers');

  // TODO could give feedback
  req.reply();
};

Block.prototype.sendScatter = function() {

  // TODO granular, throttled save
  this.saveThrottled();

  // TODO mark dirty ones and send only those to save bandwidth in realtime mode

  this.rpc('screen:$setConfig', {voters: this.voters}); // could be faster here
  this.rpc('stage:$setConfig', {voters: this.voters});
  this.rpc('control:$setConfig', {voters: this.voters});
};

// TODO this single getter or multiple, for each feature?
// TODO convert to config, no separate getData
Block.prototype.$getData = function(req) {
  if (req.channel.type == 'control' || req.channel.type == 'stage' || req.channel.type == 'screen') {
    req.reply({options: this.options, resultMeta: this.resultMeta, results: this.results});
  } else {
    // only options to web
    // TODO check if already voted, give different data then
    req.reply({options: this.options});
  }
};

if (!module.parent) {
  debug('block standalone');
}
