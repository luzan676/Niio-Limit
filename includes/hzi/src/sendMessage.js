"use strict";

/**
 * Updated for Latest Messenger API
 * Enhanced by Claude - December 2025
 */

const utils = require("../utils");
const log = require("npmlog");
const bluebird = require("bluebird");
const fs = require('fs-extra');

const allowedProperties = {
  attachment: true,
  url: true,
  sticker: true,
  emoji: true,
  emojiSize: true,
  body: true,
  mentions: true,
  location: true,
};

const AntiText = "Your criminal activity was detected while attempting to send an Appstate file";
let Location_Stack;

module.exports = function (defaultFuncs, api, ctx) {
  
  /**
   * Upload attachments to Facebook servers
   */
  function uploadAttachment(attachments, callback) {
    const uploads = [];

    for (let i = 0; i < attachments.length; i++) {
      if (!utils.isReadableStream(attachments[i])) {
        throw { error: `Attachment should be a readable stream and not ${utils.getType(attachments[i])}.` };
      }

      const form = {
        upload_1024: attachments[i],
        voice_clip: "true"
      };

      uploads.push(
        defaultFuncs
          .postFormData("https://upload.facebook.com/ajax/mercury/upload.php", ctx.jar, form, {})
          .then(utils.parseAndCheckLogin(ctx, defaultFuncs))
          .then(function (resData) {
            if (resData.error) throw resData;
            return resData.payload?.metadata?.[0] || resData.payload.metadata[0];
          })
      );
    }

    bluebird
      .all(uploads)
      .then(resData => callback(null, resData))
      .catch(function (err) {
        log.error("uploadAttachment", err);
        return callback(err);
      });
  }

  /**
   * Get URL metadata for link sharing
   */
  function getUrl(url, callback) {
    const form = {
      image_height: 960,
      image_width: 960,
      uri: url
    };

    defaultFuncs
      .post("https://www.facebook.com/message_share_attachment/fromURI/", ctx.jar, form)
      .then(utils.parseAndCheckLogin(ctx, defaultFuncs))
      .then(function (resData) {
        if (resData.error) return callback(resData);
        if (!resData.payload) return callback({ error: "Invalid url" });
        callback(null, resData.payload.share_data.share_params);
      })
      .catch(function (err) {
        log.error("getUrl", err);
        return callback(err);
      });
  }

  /**
   * Send message content to Facebook
   */
  function sendContent(form, threadID, isSingleUser, messageAndOTID, callback) {
    // Handle different thread types
    if (utils.getType(threadID) === "Array") {
      // Group chat with multiple users
      for (let i = 0; i < threadID.length; i++) {
        form[`specific_to_list[${i}]`] = "fbid:" + threadID[i];
      }
      form[`specific_to_list[${threadID.length}]`] = "fbid:" + ctx.userID;
      form["client_thread_id"] = "root:" + messageAndOTID;
      log.info("sendMessage", "Sending message to multiple users: " + threadID);
    } else {
      // Single user or existing thread
      if (isSingleUser) {
        form["specific_to_list[0]"] = "fbid:" + threadID;
        form["specific_to_list[1]"] = "fbid:" + ctx.userID;
        form["other_user_fbid"] = threadID;
      } else {
        form["thread_fbid"] = threadID;
      }
    }

    // Handle page messaging
    if (ctx.globalOptions.pageID) {
      form["author"] = "fbid:" + ctx.globalOptions.pageID;
      form["specific_to_list[1]"] = "fbid:" + ctx.globalOptions.pageID;
      form["creator_info[creatorID]"] = ctx.userID;
      form["creator_info[creatorType]"] = "direct_admin";
      form["creator_info[labelType]"] = "sent_message";
      form["creator_info[pageID]"] = ctx.globalOptions.pageID;
      form["request_user_id"] = ctx.globalOptions.pageID;
      form["creator_info[profileURI]"] = "https://www.facebook.com/profile.php?id=" + ctx.userID;
    }

    // Anti-AppState protection
    if (global.Fca?.Require?.FastConfig?.AntiSendAppState === true) {
      try {
        if (Location_Stack) {
          const location = Location_Stack.replace("Error", '').split('\n')[7]?.split(' ');
          if (location) {
            const format = {
              Source: location[6]?.split('s:')[0]?.replace("(", '') + 's',
              Line: location[6]?.split('s:')[1]?.replace(")", '')
            };
            form.body = `${AntiText}\n- Source: ${format.Source}\n- Line: ${format.Line}`;
          }
        }
      } catch (e) {
        log.error("AntiAppState", e);
      }
    }

    // Send the message
    defaultFuncs
      .post("https://www.facebook.com/messaging/send/", ctx.jar, form)
      .then(utils.parseAndCheckLogin(ctx, defaultFuncs))
      .then(function (resData) {
        Location_Stack = undefined;
        
        if (!resData) {
          return callback({ error: "Send message failed." });
        }
        
        if (resData.error) {
          if (resData.error === 1545012) {
            log.warn("sendMessage", `Got error 1545012. You might not be part of conversation ${threadID}`);
          }
          return callback(resData);
        }

        const messageInfo = resData.payload?.actions?.reduce((p, v) => ({
          threadID: v.thread_fbid,
          messageID: v.message_id,
          timestamp: v.timestamp
        }), null);

        return callback(null, messageInfo);
      })
      .catch(function (err) {
        log.error("sendMessage", err);
        if (utils.getType(err) === "Object" && err.error === "Not logged in.") {
          ctx.loggedIn = false;
        }
        return callback(err, null);
      });
  }

  /**
   * Determine thread type and send message
   */
  function send(form, threadID, messageAndOTID, callback, isGroup) {
    if (utils.getType(threadID) === "Array") {
      sendContent(form, threadID, false, messageAndOTID, callback);
    } else {
      const threadStr = String(threadID);
      
      // Initialize global arrays if needed
      global.Fca = global.Fca || {};
      global.Fca.isUser = global.Fca.isUser || [];
      global.Fca.isThread = global.Fca.isThread || [];
      global.Fca.Data = global.Fca.Data || { event: {} };

      // Determine if single user or group thread
      const isUserThread = threadStr.length <= 15 || global.Fca.isUser.includes(threadID);
      const isGroupThread = threadStr.length > 15 || global.Fca.isThread.includes(threadID);

      if (isUserThread) {
        sendContent(form, threadID, !isGroup, messageAndOTID, callback);
      } else if (isGroupThread) {
        sendContent(form, threadID, false, messageAndOTID, callback);
      } else {
        // Auto-detect thread type
        const isSingleUser = isGroup === false || threadStr.length === 15;
        sendContent(form, threadID, isSingleUser, messageAndOTID, callback);
        
        // Cache thread type
        if (global.Fca.Data.event?.isGroup) {
          global.Fca.isThread.push(threadID);
        } else {
          global.Fca.isUser.push(threadID);
        }
      }
    }
  }

  /**
   * Handle URL attachments
   */
  function handleUrl(msg, form, callback, cb) {
    if (msg.url) {
      form["shareable_attachment[share_type]"] = "100";
      getUrl(msg.url, function (err, params) {
        if (err) return callback(err);
        form["shareable_attachment[share_params]"] = params;
        cb();
      });
    } else {
      cb();
    }
  }

  /**
   * Handle location sharing
   */
  function handleLocation(msg, form, callback, cb) {
    if (msg.location) {
      if (msg.location.latitude == null || msg.location.longitude == null) {
        return callback({ error: "location property needs both latitude and longitude" });
      }
      form["location_attachment[coordinates][latitude]"] = msg.location.latitude;
      form["location_attachment[coordinates][longitude]"] = msg.location.longitude;
      form["location_attachment[is_current_location]"] = !!msg.location.current;
    }
    cb();
  }

  /**
   * Handle sticker
   */
  function handleSticker(msg, form, callback, cb) {
    if (msg.sticker) {
      form["sticker_id"] = msg.sticker;
    }
    cb();
  }

  /**
   * Handle emoji size
   */
  function handleEmoji(msg, form, callback, cb) {
    if (msg.emojiSize != null && msg.emoji == null) {
      return callback({ error: "emoji property is empty" });
    }
    
    if (msg.emoji) {
      msg.emojiSize = msg.emojiSize || "medium";
      
      if (!["small", "medium", "large"].includes(msg.emojiSize)) {
        return callback({ error: "emojiSize property is invalid" });
      }
      
      if (form["body"] != null && form["body"] !== "") {
        return callback({ error: "body is not empty" });
      }
      
      form["body"] = msg.emoji;
      form["tags[0]"] = "hot_emoji_size:" + msg.emojiSize;
    }
    cb();
  }

  /**
   * Handle file attachments with security checks
   */
  function handleAttachment(msg, form, callback, cb) {
    if (!msg.attachment) {
      return cb();
    }

    form["image_ids"] = [];
    form["gif_ids"] = [];
    form["file_ids"] = [];
    form["video_ids"] = [];
    form["audio_ids"] = [];

    if (utils.getType(msg.attachment) !== "Array") {
      msg.attachment = [msg.attachment];
    }

    const isValidAttachment = attachment => /_id$/.test(attachment[0]);

    // If attachments are already uploaded (have IDs)
    if (msg.attachment.every(isValidAttachment)) {
      msg.attachment.forEach(attachment => {
        form[`${attachment[0]}s`].push(attachment[1]);
      });
      return cb();
    }

    // Security check for AppState files
    if (global.Fca?.Require?.FastConfig?.AntiSendAppState) {
      try {
        const AllowList = [".png", ".mp3", ".mp4", ".wav", ".gif", ".jpg", ".jpeg", ".tff", ".webp"];
        const CheckList = [".json", ".js", ".txt", ".docx", ".php", ".html", ".htm"];
        let hasAppState = false;

        for (let i = 0; i < msg.attachment.length; i++) {
          if (utils.isReadableStream(msg.attachment[i])) {
            const path = msg.attachment[i].path || "nonpath";
            
            if (AllowList.some(ext => path.toLowerCase().includes(ext))) {
              continue;
            } else if (CheckList.some(ext => path.toLowerCase().includes(ext))) {
              const data = fs.readFileSync(path, 'utf-8');
              if (data.includes("datr") || data.includes("c_user") || data.includes("xs")) {
                hasAppState = true;
                const err = new Error();
                Location_Stack = err.stack;
                break;
              }
            }
          }
        }

        if (hasAppState) {
          msg.attachment = [fs.createReadStream(__dirname + "/../Extra/Src/Image/checkmate.jpg")];
        }
      } catch (e) {
        log.error("handleAttachment", "Security check failed:", e);
      }
    }

    // Upload attachments
    uploadAttachment(msg.attachment, function (err, files) {
      if (err) return callback(err);
      
      files.forEach(function (file) {
        const key = Object.keys(file);
        const type = key[0]; // image_id, file_id, etc
        form[`${type}s`].push(file[type]);
      });
      cb();
    });
  }

  /**
   * Handle mentions/tags
   */
  function handleMention(msg, form, callback, cb) {
    if (msg.mentions) {
      for (let i = 0; i < msg.mentions.length; i++) {
        const mention = msg.mentions[i];
        const tag = mention.tag;
        
        if (typeof tag !== "string") {
          return callback({ error: "Mention tags must be strings." });
        }
        
        const offset = msg.body.indexOf(tag, mention.fromIndex || 0);
        
        if (offset < 0) {
          log.warn("handleMention", `Mention for "${tag}" not found in message string.`);
        }
        
        if (mention.id == null) {
          log.warn("handleMention", "Mention id should be non-null.");
        }

        const id = mention.id || 0;
        const emptyChar = '\u200E';
        form["body"] = emptyChar + msg.body;
        form[`profile_xmd[${i}][offset]`] = offset + 1;
        form[`profile_xmd[${i}][length]`] = tag.length;
        form[`profile_xmd[${i}][id]`] = id;
        form[`profile_xmd[${i}][type]`] = "p";
      }
    }
    cb();
  }

  /**
   * Main sendMessage function
   */
  return function sendMessage(msg, threadID, callback, replyToMessage, isGroup) {
    isGroup = isGroup === undefined ? null : isGroup;

    // Validate callback
    if (!callback && (utils.getType(threadID) === "Function" || utils.getType(threadID) === "AsyncFunction")) {
      return threadID({ error: "Pass a threadID as a second argument." });
    }

    // Handle optional callback
    if (!replyToMessage && utils.getType(callback) === "String") {
      replyToMessage = callback;
      callback = function () { };
    }

    // Promise support
    let resolveFunc = function () { };
    let rejectFunc = function () { };
    const returnPromise = new Promise(function (resolve, reject) {
      resolveFunc = resolve;
      rejectFunc = reject;
    });

    if (!callback) {
      callback = function (err, data) {
        if (err) return rejectFunc(err);
        resolveFunc(data);
      };
    }

    // Validate input types
    const msgType = utils.getType(msg);
    const threadIDType = utils.getType(threadID);
    const messageIDType = utils.getType(replyToMessage);

    if (msgType !== "String" && msgType !== "Object") {
      return callback({ error: `Message should be of type string or object and not ${msgType}.` });
    }

    if (threadIDType !== "Array" && threadIDType !== "Number" && threadIDType !== "String") {
      return callback({ error: `ThreadID should be of type number, string, or array and not ${threadIDType}.` });
    }

    if (replyToMessage && messageIDType !== 'String') {
      return callback({ error: `MessageID should be of type string and not ${messageIDType}.` });
    }

    // Convert string to object
    if (msgType === "String") {
      msg = { body: msg };
    }

    // Check for disallowed properties
    const disallowedProperties = Object.keys(msg).filter(prop => !allowedProperties[prop]);
    if (disallowedProperties.length > 0) {
      return callback({ error: `Disallowed props: \`${disallowedProperties.join(", ")}\`` });
    }

    const messageAndOTID = utils.generateOfflineThreadingID();

    // Build form data
    const form = {
      client: "mercury",
      action_type: "ma-type:user-generated-message",
      author: "fbid:" + ctx.userID,
      timestamp: Date.now(),
      timestamp_absolute: "Today",
      timestamp_relative: utils.generateTimestampRelative(),
      timestamp_time_passed: "0",
      is_unread: false,
      is_cleared: false,
      is_forward: false,
      is_filtered_content: false,
      is_filtered_content_bh: false,
      is_filtered_content_account: false,
      is_filtered_content_quasar: false,
      is_filtered_content_invalid_app: false,
      is_spoof_warning: false,
      source: "source:chat:web",
      "source_tags[0]": "source:chat",
      body: msg.body ? msg.body.toString().substring(0, 20000) : "", // Limit message length
      html_body: false,
      ui_push_phase: "V3",
      status: "0",
      offline_threading_id: messageAndOTID,
      message_id: messageAndOTID,
      threading_id: utils.generateThreadingID(ctx.clientID),
      "ephemeral_ttl_mode": "0",
      manual_retry_cnt: "0",
      has_attachment: !!(msg.attachment || msg.url || msg.sticker),
      signatureID: utils.getSignatureID(),
      replied_to_message_id: replyToMessage
    };

    // Chain handlers
    handleLocation(msg, form, callback, () =>
      handleSticker(msg, form, callback, () =>
        handleAttachment(msg, form, callback, () =>
          handleUrl(msg, form, callback, () =>
            handleEmoji(msg, form, callback, () =>
              handleMention(msg, form, callback, () =>
                send(form, threadID, messageAndOTID, callback, isGroup)
              )
            )
          )
        )
      )
    );

    return returnPromise;
  };
};
