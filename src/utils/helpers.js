// Utility constants and helpers kept private to this module
const DEFAULT_DURATION = '00:00';

function isSendableChannel(channel) {
    return Boolean(channel) && typeof channel.send === 'function';
}

function twoDigit(value) {
    return String(value).padStart(2, '0');
}

function sendMessage(channel, message) {
    if (!isSendableChannel(channel)) {
        console.warn('⚠ Could not send message — no valid channel found.');
        return;
    }

    // Attempt to send; log a concise warning if it fails
    channel
        .send(message)
        .catch((err) => {
            const channelLabel = channel?.id ? ` (channel: ${channel.id})` : '';
            console.warn(`⚠ Failed to send message${channelLabel}:`, err?.message || err);
        });
}

function formatDuration(ms) {
    if (typeof ms !== 'number' || !isFinite(ms)) return DEFAULT_DURATION;
    const safeMs = Math.max(0, ms);
    const totalSeconds = Math.floor(safeMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${twoDigit(minutes)}:${twoDigit(seconds)}`;
}

module.exports = {
    sendMessage,
    formatDuration
};
