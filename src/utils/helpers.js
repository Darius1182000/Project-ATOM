function sendMessage(channel, message) {
  if (channel && typeof channel.send === "function") {
    channel.send(message).catch(err => console.warn("⚠ Failed to send message:", err.message));
  } else {
    console.warn("⚠ Could not send message — no valid channel found.");
  }
}

function formatDuration(ms) {
  if (!ms || !isFinite(ms)) return "00:00";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

module.exports = {
  sendMessage,
  formatDuration
};