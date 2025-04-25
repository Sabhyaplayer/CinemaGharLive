// api/getVideos.js

export default async function handler(req, res) {
    // Allow requests from anywhere (for simplicity, Vercel handles this well)
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

    // --- Using getChatHistory ---
    // Requires Bot to be ADMIN
    // Let's limit to recent 100 messages for performance. Adjust if needed.
    const HISTORY_LIMIT = 100;
    const apiUrl = `https://api.telegram.org/bot${BOT_TOKEN}/getChatHistory?chat_id=${CHANNEL_ID}&limit=${HISTORY_LIMIT}`;

    try {
        console.log(`Fetching history for channel: ${CHANNEL_ID}`);
        const response = await fetch(apiUrl);

        // Check if the initial fetch failed (e.g., 404 Not Found for the channel/bot combo)
        if (!response.ok) {
            const errorData = await response.json();
            console.error('Telegram API Error (getChatHistory):', response.status, errorData);
            // Throw specific error to be caught below
            throw new Error(`Telegram API Error: ${errorData.description || response.statusText}`);
        }

        const data = await response.json();
        console.log(`Received ${data.result?.messages?.length || 0} messages.`);

        if (!data.ok || !data.result || !data.result.messages) {
             console.error('Invalid data structure received from Telegram:', data);
             throw new Error('Failed to fetch messages or invalid data structure.');
        }

        // --- CORRECTED FILTER ---
        // Filter for messages that have EITHER a 'video' OR a 'document' property
        // You could add stricter document mime-type checks here if needed later
        const mediaMessages = data.result.messages.filter(msg => msg.video || msg.document);
        // --- END CORRECTED FILTER ---

        console.log(`Found ${mediaMessages.length} potential media messages.`);

        // --- CORRECTED MAPPING LOGIC ---
        // Use Promise.all to fetch file paths concurrently
        const mediaDataPromises = mediaMessages.map(async (msg) => {
            let fileId = null;
            let caption = msg.caption || ''; // Start with caption, if any
            let fileName = ''; // To store the filename for fallback caption

            // Determine if it's a video or document and extract data
            if (msg.video) {
                fileId = msg.video.file_id;
                fileName = msg.video.file_name || '';
            } else if (msg.document) {
                fileId = msg.document.file_id;
                fileName = msg.document.file_name || '';
                // Optional: Add mime-type check here if you ONLY want video documents
                // if (!msg.document.mime_type || !msg.document.mime_type.startsWith('video/')) {
                //     console.log(`Skipping document with non-video mime_type: ${msg.document.mime_type}`);
                //     return null;
                // }
            } else {
                 // Should not happen due to the filter, but safeguard
                return null;
            }

            // Create a fallback caption if none exists
            if (!caption) {
                caption = fileName || `Media ${msg.message_id}`; // Use filename or message ID
            }

            const messageId = msg.message_id; // Unique identifier for React key

            // Fetch the file path to create a temporary download link
            const fileInfoUrl = `https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`;
            try {
                const fileInfoResponse = await fetch(fileInfoUrl);
                if (!fileInfoResponse.ok) {
                     const errorData = await fileInfoResponse.json();
                     console.error(`Failed to get file info for file_id ${fileId} (message ${messageId}):`, fileInfoResponse.status, errorData);
                     // Skip this media if we can't get file info (e.g., file too big, expired)
                     return null;
                }
                const fileInfoData = await fileInfoResponse.json();

                if (!fileInfoData.ok || !fileInfoData.result || !fileInfoData.result.file_path) {
                    console.error(`Invalid file info structure for file_id ${fileId} (message ${messageId}):`, fileInfoData);
                    return null; // Skip this media
                }

                const filePath = fileInfoData.result.file_path;
                // Construct the temporary direct download URL (valid for ~1 hour)
                const downloadUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;

                return {
                    id: messageId, // Use message_id as a unique key
                    caption: caption,
                    downloadUrl: downloadUrl,
                };
            } catch (fileError) {
                console.error(`Error processing file_id ${fileId} (message ${messageId}):`, fileError);
                return null; // Skip this media on error
            }
        });
        // --- END CORRECTED MAPPING LOGIC ---

        // Wait for all file info requests to complete and filter out nulls (errors or skipped items)
        const videos = (await Promise.all(mediaDataPromises)).filter(media => media !== null); // Changed var name, but keep 'videos' for response

        // Optional: Reverse the order so newest media appear first
        videos.reverse();

        console.log(`Successfully processed ${videos.length} media items to display.`);
        // Return the processed list, keeping the key 'videos' for frontend compatibility
        res.status(200).json({ videos });

    } catch (error) {
        console.error('Error in API function:', error);
        // Check if it's the specific Telegram API error we threw earlier
        if (error.message.startsWith('Telegram API Error:')) {
             res.status(502).json({ error: 'Failed to communicate with Telegram.', details: error.message }); // Bad Gateway might be more appropriate
        } else {
             res.status(500).json({ error: 'Failed to process videos.', details: error.message });
        }
    }
}
