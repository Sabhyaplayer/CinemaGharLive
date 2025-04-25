// api/getVideos.js

export default async function handler(req, res) {
    // Allow requests from anywhere (for simplicity, Vercel handles this well)
    // In production, you might restrict this to your deployed frontend URL
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle CORS preflight requests
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    // Ensure this function only handles GET requests
    if (req.method !== 'GET') {
        res.setHeader('Allow', ['GET']);
        return res.status(405).end(`Method ${req.method} Not Allowed`);
    }

    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID; // Should be the negative number like -100xxxxxxxxx

    if (!BOT_TOKEN || !CHANNEL_ID) {
        console.error("Error: Bot Token or Channel ID not configured in environment variables.");
        return res.status(500).json({ error: 'Server configuration error.' });
    }

    // --- Option 1: Using getChatHistory (Might be heavy if channel is huge) ---
    // Requires Bot to be ADMIN
    // Let's limit to recent 100 messages for performance. Adjust if needed.
    const HISTORY_LIMIT = 100;
    const apiUrl = `https://api.telegram.org/bot${BOT_TOKEN}/getChatHistory?chat_id=${CHANNEL_ID}&limit=${HISTORY_LIMIT}`;

    // --- Option 2: Using getUpdates (More complex due to offset handling) ---
    // Might be better for *very* large channels, but harder to implement reliably here.
    // We will stick with getChatHistory for simplicity in this example.

    try {
        console.log(`Fetching history for channel: ${CHANNEL_ID}`);
        const response = await fetch(apiUrl);
        if (!response.ok) {
            const errorData = await response.json();
            console.error('Telegram API Error (getChatHistory):', response.status, errorData);
            throw new Error(`Telegram API Error: ${errorData.description || response.statusText}`);
        }

        const data = await response.json();
        console.log(`Received ${data.result?.messages?.length || 0} messages.`);

        if (!data.ok || !data.result || !data.result.messages) {
             console.error('Invalid data structure received from Telegram:', data);
             throw new Error('Failed to fetch messages or invalid data structure.');
        }

        const videoMessages = data.result.messages.filter(msg => msg.video);

        console.log(`Found ${videoMessages.length} video messages.`);

        // Use Promise.all to fetch file paths concurrently
        const videoDataPromises = videoMessages.map(async (msg) => {
            const video = msg.video;
            const fileId = video.file_id;
            const caption = msg.caption || video.file_name || `Video ${msg.message_id}`; // Use filename or ID as fallback caption
            const messageId = msg.message_id; // Unique identifier

            // Fetch the file path to create a temporary download link
            const fileInfoUrl = `https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`;
            try {
                const fileInfoResponse = await fetch(fileInfoUrl);
                if (!fileInfoResponse.ok) {
                     const errorData = await fileInfoResponse.json();
                     console.error(`Failed to get file info for file_id ${fileId}:`, fileInfoResponse.status, errorData);
                     // Skip this video if we can't get file info
                     return null;
                }
                const fileInfoData = await fileInfoResponse.json();

                if (!fileInfoData.ok || !fileInfoData.result || !fileInfoData.result.file_path) {
                    console.error(`Invalid file info structure for file_id ${fileId}:`, fileInfoData);
                    // Skip this video
                    return null;
                }

                const filePath = fileInfoData.result.file_path;
                // Construct the temporary direct download URL (valid for ~1 hour)
                const downloadUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;

                return {
                    id: messageId, // Use message_id as a unique key
                    caption: caption,
                    downloadUrl: downloadUrl,
                    // You could add other info like duration, thumbnail_file_id etc. if needed
                    // thumbnailUrl: video.thumb ? `https://api.telegram.org/file/bot${BOT_TOKEN}/${(await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${video.thumb.file_id}`)).json().result.file_path}` : null
                };
            } catch (fileError) {
                console.error(`Error processing file_id ${fileId}:`, fileError);
                return null; // Skip this video on error
            }
        });

        // Wait for all file info requests to complete and filter out nulls (errors)
        const videos = (await Promise.all(videoDataPromises)).filter(video => video !== null);

        // Optional: Reverse the order so newest videos appear first
        videos.reverse();

        console.log(`Successfully processed ${videos.length} videos.`);
        res.status(200).json({ videos });

    } catch (error) {
        console.error('Error in API function:', error);
        res.status(500).json({ error: 'Failed to fetch videos from Telegram.', details: error.message });
    }
}