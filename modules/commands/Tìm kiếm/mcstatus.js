const axios = require('axios');

this.config = {
  name: "mcstatus",
  version: "2.0.0",
  hasPermission: 0,
  credits: "HuyKaiser",
  description: "Kiểm tra trạng thái server Minecraft",
  commandCategory: "Tìm kiếm",
  usages: "ip:<địa chỉ:port>",
  cooldowns: 2,
};

this.run = async function ({ args, api, event }) {
  const send = (msg) => api.sendMessage(msg, event.threadID, event.messageID);
  
  // Kiểm tra đầu vào
  if (args.length === 0) {
    return send(
      `╔═══ MINECRAFT STATUS ═══╗\n` +
      `║ Sử dụng: ${this.config.name} ip:<địa chỉ:port>\n` +
      `║ \n` +
      `║ Ví dụ:\n` +
      `║ • ${this.config.name} ip:rivermoon.site:19132\n` +
      `╚════════════════════════════╝`
    );
  }

  const input = args.join(' ');
  
  // Kiểm tra format ip:
  if (!input.startsWith('ip:')) {
    return send(
      `❌ Format không đúng!\n` +
      `✅ Sử dụng: ${this.config.name} ip:<địa chỉ:port>\n` +
      `💡 Ví dụ: ${this.config.name} ip:hypixel.net:25565`
    );
  }

  // Lấy địa chỉ server
  const serverAddress = input.substring(3).trim();
  
  if (!serverAddress) {
    return send(`❌ Vui lòng nhập địa chỉ server!`);
  }

  // Hiển thị đang tải
  await send(`⏳ Đang kiểm tra server ${serverAddress}...`);

  // Thử cả Java và Bedrock
  const editions = ['java', 'bedrock'];
  let successResponse = null;
  let lastError = null;

  for (const edition of editions) {
    try {
      const apiUrl = `https://api.mcstatus.io/v2/status/${edition}/${serverAddress}`;
      const response = await axios.get(apiUrl, { timeout: 10000 });
      
      if (response.data.online) {
        successResponse = { data: response.data, edition };
        break;
      }
    } catch (error) {
      lastError = error;
      continue;
    }
  }

  // Nếu không tìm thấy server nào online
  if (!successResponse) {
    let errorMessage = `╔═══ LỖI ═══╗\n`;
    errorMessage += `║ ❌ Không thể kết nối server!\n`;
    errorMessage += `║ \n`;
    errorMessage += `║ 📍 Server: ${serverAddress}\n`;
    errorMessage += `║ \n`;
    
    if (lastError) {
      if (lastError.code === 'ECONNABORTED' || lastError.code === 'ETIMEDOUT') {
        errorMessage += `║ ⚠️ Lỗi: Timeout (Quá thời gian chờ)\n`;
      } else if (lastError.response?.status === 404) {
        errorMessage += `║ ⚠️ Lỗi: Không tìm thấy server\n`;
      } else {
        errorMessage += `║ ⚠️ Server không online hoặc không tồn tại\n`;
      }
    }
    
    errorMessage += `║ \n`;
    errorMessage += `║ 💡 Kiểm tra lại:\n`;
    errorMessage += `║ • Địa chỉ server đúng chưa?\n`;
    errorMessage += `║ • Port có chính xác không?\n`;
    errorMessage += `║ • Server có đang online?\n`;
    errorMessage += `╚════════════════════╝`;
    
    return send(errorMessage);
  }

  // Lấy thông tin từ response thành công
  const { data, edition } = successResponse;
  const {
    host,
    port,
    players = {},
    motd = {},
    version = {},
    gamemode,
  } = data;

  const onlinePlayers = players.online || 0;
  const maxPlayers = players.max || 0;
  const serverName = motd.clean || motd.raw || "Không có tên";
  const serverVersion = version.name || "Không xác định";
  const serverGamemode = gamemode || "Không xác định";

  // Format tin nhắn đẹp
  let message = `╔═══ SERVER STATUS ═══╗\n`;
  message += `║ 🟢 Trạng thái: ONLINE\n`;
  message += `║ \n`;
  message += `║ 📍 Địa chỉ: ${host}:${port}\n`;
  message += `║ 🎮 Phiên bản: ${edition.toUpperCase()}\n`;
  message += `║ 📦 Version: ${serverVersion}\n`;
  message += `║ \n`;
  message += `║ 👥 Người chơi: ${onlinePlayers}/${maxPlayers}\n`;
  
  if (edition === 'java' && serverGamemode !== "Không xác định") {
    message += `║ 🎯 Gamemode: ${serverGamemode}\n`;
  }
  
  message += `║ \n`;
  message += `║ 📝 Tên server:\n`;
  
  // Xử lý tên server nhiều dòng
  const nameLines = serverName.split('\n').filter(line => line.trim());
  nameLines.slice(0, 2).forEach(line => {
    message += `║ ${line.substring(0, 50)}\n`;
  });
  
  // Hiển thị danh sách người chơi nếu có
  if (players.list && players.list.length > 0) {
    message += `║ \n`;
    message += `║ 👤 Người chơi online:\n`;
    const playerNames = players.list.slice(0, 5).map(p => p.name_clean || p.name);
    playerNames.forEach(name => {
      message += `║ • ${name}\n`;
    });
    if (players.list.length > 5) {
      message += `║ ... và ${players.list.length - 5} người khác\n`;
    }
  }
  
  message += `╚═══════════════════════╝`;

  send(message);
};
