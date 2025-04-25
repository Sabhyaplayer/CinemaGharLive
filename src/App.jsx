// src/App.jsx
import { useState, useEffect, useMemo } from 'react';
// No need to import App.css if we deleted its content
// import './App.css'; // We are using index.css for global styles

function App() {
  const [videos, setVideos] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Fetch videos from our backend API
  useEffect(() => {
    setLoading(true);
    setError(null);
    // The '/api/getVideos' path will automatically work when deployed on Vercel
    // For local testing, Vercel CLI handles proxying, or configure vite.config.js
    fetch('/api/getVideos')
      .then(response => {
        if (!response.ok) {
          // Try to parse error message from backend
          return response.json().then(errData => {
            throw new Error(errData.error || `HTTP error! status: ${response.status}`);
          }).catch(() => {
              // Fallback if response is not JSON or error parsing fails
              throw new Error(`HTTP error! status: ${response.status}`);
          });
        }
        return response.json();
      })
      .then(data => {
        if (data.videos && Array.isArray(data.videos)) {
           setVideos(data.videos);
        } else {
           console.error("Received unexpected data structure:", data);
           throw new Error("Invalid data format received from server.");
        }
        setLoading(false);
      })
      .catch(err => {
        console.error("Fetch error:", err);
        setError(`Failed to load videos: ${err.message}. Check console or server logs.`);
        setLoading(false);
      });
  }, []); // Empty dependency array means this runs once on mount

  // Filter videos based on search term (case-insensitive)
  const filteredVideos = useMemo(() => {
    if (!searchTerm) {
      return videos; // Return all videos if search is empty
    }
    return videos.filter(video =>
      video.caption.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [videos, searchTerm]); // Recalculate only when videos or searchTerm changes

  return (
    <>
      <h1>🎬 Cinema Ghar Index</h1>

      <input
        type="text"
        placeholder="Search videos by caption..."
        className="search-bar"
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        disabled={loading || error} // Disable search if loading or error
      />

      {loading && <p className="loading">Loading videos...</p>}

      {error && <p className="error">{error}</p>}

      {!loading && !error && (
        <div className="video-grid">
          {filteredVideos.length > 0 ? (
            filteredVideos.map((video) => (
              <div key={video.id} className="video-card">
                <video controls preload="metadata"> {/* preload="metadata" loads dimensions, etc. */}
                  <source src={video.downloadUrl} type="video/mp4" /> {/* Adjust type if needed, though browser often detects */}
                  Your browser does not support the video tag.
                </video>
                <p className="caption">{video.caption}</p>
              </div>
            ))
          ) : (
            <p>No videos found{searchTerm ? ' matching your search' : ''}. Forward videos to your Telegram channel!</p>
          )}
        </div>
      )}
    </>
  );
}

export default App;