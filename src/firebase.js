/**
 * Music Blog - Firebase Integration
 * 
 * This file implements the Firebase backend for the Music Blog using MVC design pattern:
 * - Model: Handles data interactions with Firebase (auth, Firestore)
 * - View: Manages the DOM updates and UI rendering
 * - Controller: Coordinates between Model and View, handles user interactions
 */
import firebaseConfig from './firebaseConfig';

document.addEventListener('DOMContentLoaded', function() {
    // --- Check for firebaseConfig ---
    console.log("Verifying firebaseConfig file...");
    if (!window.firebaseConfig || !window.firebaseConfig.apiKey) {
        console.error("Firebase configuration is missing or not loaded properly. Please check that firebaseConfig.js is in the correct location.");
    } else {
        console.log("Firebase configuration loaded successfully:", window.firebaseConfig);
    }
    
    /**
     * MODEL
     * Handles all Firebase data operations and business logic
     */
    const Model = {
        // Firebase configuration loaded from exported.
        firebaseConfig: firebaseConfig,
        
        // Firebase references
        firebaseAuth: null, // renamed from "auth"
        db: null,
        
        // Initialize Firebase services
        init: function() {
            // Check if Firebase is already initialized
            if (!firebase.apps.length) {
                if (!this.firebaseConfig.apiKey) {
                    console.error('Firebase configuration is missing. Please check your firebaseConfig.js file.');
                    return { firebaseAuth: null, db: null };
                }
                firebase.initializeApp(this.firebaseConfig);
            }
            
            this.firebaseAuth = firebase.auth();
            this.db = firebase.firestore();
            
            return {
                firebaseAuth: this.firebaseAuth,
                db: this.db
            };
        },
        
        // Authentication methods
        auth: {
            login: async function(email, password) {
                try {
                    return await Model.firebaseAuth.signInWithEmailAndPassword(email, password);
                } catch (error) {
                    throw error;
                }
            },
            
            logout: async function() {
                try {
                    return await Model.firebaseAuth.signOut();
                } catch (error) {
                    throw error;
                }
            },
            
            getCurrentUser: function() {
                return Model.firebaseAuth.currentUser;
            },
            
            onAuthStateChanged: function(callback) {
                return Model.firebaseAuth.onAuthStateChanged(callback);
            }
        },
        
        // Posts methods
        posts: {
            create: async function(postData) {
                try {
                    const user = Model.auth.getCurrentUser();
                    if (!user) throw new Error('Not authenticated');
                    
                    const post = {
                        title: postData.title,
                        subtitle: postData.subtitle,
                        content: postData.content,
                        thumbnail: postData.thumbnail || '', 
                        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
                        authorId: user.uid,
                        authorEmail: user.email,
                        pinned: postData.pinned || false // Add pinned field
                    };
                    
                    return await Model.db.collection('music-posts').add(post);
                } catch (error) {
                    throw error;
                }
            },

            update: async function(postId, postData) {
                try {
                    const user = Model.auth.getCurrentUser();
                    if (!user) throw new Error('Not authenticated');
                    
                    const updateData = {
                        title: postData.title,
                        subtitle: postData.subtitle,
                        content: postData.content,
                        thumbnail: postData.thumbnail || '',
                        pinned: postData.pinned || false,
                        lastEdited: firebase.firestore.FieldValue.serverTimestamp()
                    };
                    
                    return await Model.db.collection('music-posts').doc(postId).update(updateData);
                } catch (error) {
                    console.error('Error updating post:', error);
                    throw error;
                }
            },
            
            getAllPosts: async function() {
                try {
                    const snapshot = await Model.db.collection('music-posts')
                        .orderBy('pinned', 'desc') // Order by pinned status first
                        .orderBy('timestamp', 'desc') // Then by timestamp
                        .get();
                    
                    // Filter out the site-data document
                    return snapshot.docs
                        .filter(doc => doc.id !== 'site-data')
                        .map(doc => ({
                            id: doc.id,
                            ...doc.data()
                        }));
                } catch (error) {
                    throw error;
                }
            },
            
            getPaginatedPosts: async function(page = 1, postsPerPage = 10) {
                try {
                    // Get all posts first to calculate total pages (excluding site-data)
                    const snapshot = await Model.db.collection('music-posts')
                        .orderBy('pinned', 'desc') // Order by pinned status first
                        .orderBy('timestamp', 'desc') // Then by timestamp
                        .get();
                    
                    // Filter out the site-data document
                    const allPosts = snapshot.docs
                        .filter(doc => doc.id !== 'site-data');
                        
                    const totalPosts = allPosts.length;
                    const totalPages = Math.ceil(totalPosts / postsPerPage);
                    
                    // If page is beyond available pages, return last page
                    if (page > totalPages && totalPages > 0) {
                        page = totalPages;
                    }
                    
                    // Get posts for the current page
                    const pageOffset = (page - 1) * postsPerPage;
                    const pagePosts = allPosts.slice(pageOffset, pageOffset + postsPerPage)
                        .map(doc => ({
                            id: doc.id,
                            ...doc.data()
                        }));
                        
                    return {
                        posts: pagePosts,
                        currentPage: page,
                        totalPages,
                        totalPosts
                    };
                } catch (error) {
                    throw error;
                }
            },

            getPost: async function(postId) {
                try {
                    const doc = await Model.db.collection('music-posts')
                        .doc(postId)
                        .get();
                    
                    if (!doc.exists) {
                        throw new Error('Post not found');
                    }
                    
                    return {
                        id: doc.id,
                        ...doc.data()
                    };
                } catch (error) {
                    throw error;
                }
            },
            deletePost: async function(postId) {
                try {
                    // Check if user is admin
                    const user = Model.auth.getCurrentUser();
                    if (!user) throw new Error('Not authenticated');
                    
                    // First, get all comments for this post
                    const commentsSnapshot = await Model.db.collection('music-posts')
                        .doc(postId)
                        .collection('comments')
                        .get();
                    
                    // Delete all comments
                    const batch = Model.db.batch();
                    commentsSnapshot.docs.forEach(doc => {
                        batch.delete(doc.ref);
                    });
                    
                    // Delete the post
                    batch.delete(Model.db.collection('music-posts').doc(postId));
                    
                    // Commit the batch
                    return await batch.commit();
                } catch (error) {
                    console.error('Error deleting post:', error);
                    throw error;
                }
            }
            
        },
        
        // Comments methods
        comments: {
            create: async function(postId, commentData) {
                try {
                    // Get client IP for tracking comment author
                    const ipResponse = await fetch('https://api.ipify.org?format=json');
                    const ipData = await ipResponse.json();
                    const userIp = ipData.ip;
                    
                    // Create comment object with path tracking
                    const comment = {
                        authorName: commentData.authorName || 'Anonymous',
                        content: commentData.content,
                        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
                        parentId: commentData.parentId || null,
                        ancestors: commentData.ancestors || [], // Array of parent IDs to track the full path
                        depth: commentData.depth || 0, // Numerical depth for easier querying
                        authorIp: userIp,
                        likes: 0,
                        likedIps: []
                    };
                    
                    return await Model.db.collection('music-posts')
                        .doc(postId)
                        .collection('comments')
                        .add(comment);
                } catch (error) {
                    throw error;
                }
            },

            getThreadForComment: async function(postId, commentId) {
                try {
                    // First get the comment itself
                    const commentDoc = await Model.db.collection('music-posts')
                        .doc(postId)
                        .collection('comments')
                        .doc(commentId)
                        .get();
                        
                    if (!commentDoc.exists) {
                        throw new Error('Comment not found');
                    }
                    
                    const comment = {
                        id: commentDoc.id,
                        ...commentDoc.data()
                    };
                    
                    // Then get all descendants of this comment
                    const repliesSnapshot = await Model.db.collection('music-posts')
                        .doc(postId)
                        .collection('comments')
                        .where('ancestors', 'array-contains', commentId)
                        .orderBy('depth', 'asc')
                        .orderBy('timestamp', 'asc')
                        .get();
                        
                    const replies = repliesSnapshot.docs.map(doc => ({
                        id: doc.id,
                        ...doc.data()
                    }));
                    
                    // If this is a reply itself, get its ancestors too
                    let ancestors = [];
                    if (comment.ancestors && comment.ancestors.length > 0) {
                        const ancestorsSnapshot = await Model.db.collection('music-posts')
                            .doc(postId)
                            .collection('comments')
                            .where(firebase.firestore.FieldPath.documentId(), 'in', comment.ancestors)
                            .get();
                            
                        ancestors = ancestorsSnapshot.docs.map(doc => ({
                            id: doc.id,
                            ...doc.data()
                        }));
                    }
                    
                    return {
                        comment,
                        replies,
                        ancestors
                    };
                } catch (error) {
                    throw error;
                }
            },
            // Add to Model.comments in src/firebase.js
            // Replace the existing deleteComment method in Model.comments
            deleteComment: async function(postId, commentId) {
                try {
                    // Get client IP to check if user is the author
                    const ipResponse = await fetch('https://api.ipify.org?format=json');
                    const ipData = await ipResponse.json();
                    const userIp = ipData.ip;
                    
                    // Get the comment
                    const commentRef = Model.db.collection('music-posts')
                        .doc(postId)
                        .collection('comments')
                        .doc(commentId);
                    
                    const comment = await commentRef.get();
                    
                    if (!comment.exists) {
                        throw new Error('Comment not found');
                    }
                    
                    // Check if current user is the author or admin
                    const isAuthor = comment.data().authorIp === userIp;
                    const isAdmin = Model.auth.getCurrentUser() !== null;
                    
                    if (!isAuthor && !isAdmin) {
                        throw new Error('You can only delete your own comments');
                    }
                    
                    // For non-admin users who are authors, we need a workaround
                    // since Firestore rules only allow deletion for authenticated users
                    if (isAuthor && !isAdmin) {
                        // Instead of deleting, we'll update the comment to mark it as deleted
                        await commentRef.update({
                            content: "[Comment deleted by author]",
                            deletedByAuthor: true,
                            originalContent: comment.data().content  // Save original in case needed
                        });
                        return { updated: true };
                    }
                    
                    // For admins, proceed with actual deletion
                    if (isAdmin) {
                        await commentRef.update({
                            content: "[Comment deleted by admin]",
                            deletedByAdmin: true,
                            originalContent: comment.data().content  // Save original in case needed
                        });
                        return { updated: true };
                    }
                } catch (error) {
                    console.error('Error deleting comment:', error);
                    throw error;
                }
            },

            

            getRecentComments: async function(postId, limit = 3) {
                try {
                    const snapshot = await Model.db.collection('music-posts')
                        .doc(postId)
                        .collection('comments')
                        .where('parentId', '==', null) // Only top-level comments
                        .orderBy('timestamp', 'desc')  // Most recent first
                        .limit(limit)
                        .get();
                    
                    return snapshot.docs.map(doc => ({
                        id: doc.id,
                        ...doc.data()
                    }));
                } catch (error) {
                    throw error;
                }
            },
            
            likeComment: async function(postId, commentId) {
                try {
                    // Get client IP address for tracking likes
                    const ipResponse = await fetch('https://api.ipify.org?format=json');
                    const ipData = await ipResponse.json();
                    const userIp = ipData.ip;
                    
                    // Get the current comment
                    const commentRef = Model.db.collection('music-posts')
                        .doc(postId)
                        .collection('comments')
                        .doc(commentId);
                        
                    const comment = await commentRef.get();
                    
                    if (!comment.exists) {
                        throw new Error('Comment not found');
                    }
                    
                    // Get current likes count and liked IPs array (or initialize them)
                    const currentLikes = comment.data().likes || 0;
                    const likedIps = comment.data().likedIps || [];
                    const commentAuthorIp = comment.data().authorIp || null;
                    
                    // Check if this IP has already liked the comment or is the author
                    if (likedIps.includes(userIp) || userIp === commentAuthorIp) {
                        return { alreadyLiked: true, isAuthor: userIp === commentAuthorIp };
                    }
                    
                    // Update the likes count and add the user's IP to the likedIps array
                    return await commentRef.update({
                        likes: currentLikes + 1,
                        likedIps: firebase.firestore.FieldValue.arrayUnion(userIp)
                    });
                } catch (error) {
                    console.error('Error in likeComment:', error);
                    throw error;
                }
            },
            getTopLikedComments: async function(postId, limit = 3) {
                try {
                    const snapshot = await Model.db.collection('music-posts')
                        .doc(postId)
                        .collection('comments')
                        .where('parentId', '==', null)
                        .orderBy('likes', 'desc')
                        .limit(limit)
                        .get();
                    
                    return snapshot.docs.map(doc => ({
                        id: doc.id,
                        ...doc.data()
                    }));
                } catch (error) {
                    throw error;
                }
            },
            
            getTopLevelComments: async function(postId) {
                try {
                    const snapshot = await Model.db.collection('music-posts')
                        .doc(postId)
                        .collection('comments')
                        .where('parentId', '==', null)
                        .orderBy('timestamp', 'desc')
                        .get();
                    
                    return snapshot.docs.map(doc => ({
                        id: doc.id,
                        ...doc.data()
                    }));
                } catch (error) {
                    throw error;
                }
            },
            
            getReplies: async function(postId, commentId) {
                try {
                    const snapshot = await Model.db.collection('music-posts')
                        .doc(postId)
                        .collection('comments')
                        .where('parentId', '==', commentId)
                        .orderBy('timestamp', 'desc')
                        .get();
                    
                    return snapshot.docs.map(doc => ({
                        id: doc.id,
                        ...doc.data()
                    }));
                } catch (error) {
                    throw error;
                }
            }
        },
        visitors: {
            // Record a new visitor by IP
            recordVisit: async function() {
                try {
                    // Get the visitor's IP address
                    const ipResponse = await fetch('https://api.ipify.org?format=json');
                    const ipData = await ipResponse.json();
                    const visitorIp = ipData.ip;
                    
                    // Use a specific post document for site-wide data
                    const siteDataPostId = 'site-data';
                    
                    // Create the site-data document if it doesn't exist
                    const siteDataRef = Model.db.collection('music-posts').doc(siteDataPostId);
                    const siteDoc = await siteDataRef.get();
                    if (!siteDoc.exists) {
                        await siteDataRef.set({
                            title: 'Site Data',
                            subtitle: 'Technical document for site metrics',
                            content: 'This document stores site-wide data and metrics.',
                            timestamp: firebase.firestore.FieldValue.serverTimestamp()
                        });
                    }
                    
                    // Reference to the visitors collection as a subcollection
                    const visitorsRef = siteDataRef.collection('visitors');
                    
                    // Check if this IP has visited before
                    const visitorDoc = await visitorsRef.doc(visitorIp).get();
                    
                    if (!visitorDoc.exists) {
                        // This is a new visitor, add them to the collection
                        await visitorsRef.doc(visitorIp).set({
                            firstVisit: firebase.firestore.FieldValue.serverTimestamp(),
                            visits: 1
                        });
                        
                        // Increment the counter in a separate counter document
                        const counterRef = siteDataRef.collection('counters').doc('visitors');
                        await counterRef.set({
                            count: firebase.firestore.FieldValue.increment(1)
                        }, { merge: true });
                    } else {
                        // This visitor has been here before, just update their visit count
                        await visitorsRef.doc(visitorIp).update({
                            lastVisit: firebase.firestore.FieldValue.serverTimestamp(),
                            visits: firebase.firestore.FieldValue.increment(1)
                        });
                    }
                    
                    return await this.getVisitorCount();
                } catch (error) {
                    console.error('Error recording visitor:', error);
                    return null;
                }
            },
            
            // Get the current visitor count
            getVisitorCount: async function() {
                try {
                    // Fixed post ID for site-wide data
                    const siteDataPostId = 'site-data';
                    
                    const counterDoc = await Model.db.collection('music-posts').doc(siteDataPostId)
                        .collection('counters').doc('visitors').get();
                        
                    if (counterDoc.exists) {
                        return counterDoc.data().count;
                    } else {
                        // If counter document doesn't exist yet, create it
                        await Model.db.collection('music-posts').doc(siteDataPostId)
                            .collection('counters').doc('visitors').set({ count: 0 });
                        return 0;
                    }
                } catch (error) {
                    console.error('Error getting visitor count:', error);
                    return null;
                }
            }
        }
    };
    
    /**
     * VIEW
     * Handles all DOM manipulations and UI rendering
     */
    const View = {
        // DOM elements
        elements: {
            loginBtn: document.getElementById('login-btn'),
            logoutBtn: document.getElementById('logout-btn'),
            userStatus: document.getElementById('user-status'),
            adminPanel: document.getElementById('admin-panel'),
            loginModal: document.getElementById('login-modal'),
            closeLoginBtn: document.getElementById('close-login'),
            adminLoginForm: document.getElementById('admin-login-form'),
            postForm: document.getElementById('post-form'),
            musicPostsContainer: document.getElementById('music-posts')
        },
        
        // Stars background generation
        generateStars: function() {
            const starsContainer = document.getElementById('stars');
            const numberOfStars = 200;
            
            if (!starsContainer) return;
            
            for (let i = 0; i < numberOfStars; i++) {
                const star = document.createElement('div');
                const size = Math.random() * 2;
                
                star.style.position = 'absolute';
                star.style.width = `${size}px`;
                star.style.height = `${size}px`;
                star.style.backgroundColor = 'white';
                star.style.borderRadius = '50%';
                star.style.left = `${Math.random() * 100}%`;
                star.style.top = `${Math.random() * 100}%`;
                star.style.opacity = Math.random();
                
                if (Math.random() > 0.7) {
                    star.style.animation = `blink ${2 + Math.random() * 3}s infinite`;
                }
                
                starsContainer.appendChild(star);
            }
            const marqueeContent = document.querySelector('.marquee-content');
            if (marqueeContent) {
                // Only repeat content if animations are not disabled
                const content = marqueeContent.textContent.trim();
                const animationsDisabled = document.body.classList.contains('animations-disabled');

                if (!animationsDisabled) {
                    marqueeContent.textContent = content + ' • ' + content + ' • ' + content;
                    marqueeContent.style.animationDelay = "0s";
                }
            }
        },
        
        // Authentication UI updates
        auth: {
            updateUI: function(user) {
                if (user) {
                    View.elements.userStatus.textContent = `Logged in as Admin (${user.email})`;
                    View.elements.loginBtn.style.display = 'none';
                    View.elements.logoutBtn.style.display = 'inline-block';
                    View.elements.adminPanel.style.display = 'block';
                } else {
                    View.elements.userStatus.textContent = 'Not logged in';
                    View.elements.loginBtn.style.display = 'inline-block';
                    View.elements.logoutBtn.style.display = 'none';
                    View.elements.adminPanel.style.display = 'none';
                }
            },
            
            showLoginModal: function() {
                View.elements.loginModal.style.display = 'flex';
            },
            
            hideLoginModal: function() {
                View.elements.loginModal.style.display = 'none';
            },
            
            clearLoginForm: function() {
                View.elements.adminLoginForm.reset();
            }
        },
        
        // Posts rendering
        posts: {
            renderAll: function(posts) {
                const container = View.elements.musicPostsContainer;
                
                // Remove loading indicator if it exists
                const loadingIndicator = document.getElementById('loading-indicator');
                if (loadingIndicator) {
                    loadingIndicator.remove();
                }
                
                // Clear container
                container.innerHTML = '';
                
                if (posts.length === 0) {
                    // Show message when no posts are available
                    const noPostsMessage = document.createElement('div');
                    noPostsMessage.className = 'post';
                    noPostsMessage.innerHTML = `
                        <div class="post-header">
                            <h2 class="post-title">No Posts Yet</h2>
                            <h3 class="post-subtitle">Stay tuned for upcoming music content</h3>
                        </div>
                        <div class="post-content">
                            <p>The admin hasn't added any music posts yet. Check back soon!</p>
                        </div>
                    `;
                    container.appendChild(noPostsMessage);
                    return;
                }
                
                posts.forEach(post => {
                    const postElement = View.posts.createPostElement(post.id, post);
                    container.appendChild(postElement);
                });
            },
            
            // Replace the existing createPostElement function in View.posts
            createPostElement: function(postId, post, isPreview = true) {
                const postDiv = document.createElement('div');
                postDiv.className = 'post';
                postDiv.setAttribute('data-post-id', postId);
                
                let dateDisplay = 'Just now';
                if (post.timestamp) {
                    const date = post.timestamp.toDate();
                    dateDisplay = date.toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric'
                    });
                }
                
                let htmlContent = marked.parse(post.content);
                
                // Process YouTube embeds
                const videoRegex = /!\[video\]\((https:\/\/(?:www\.)?youtu(?:be\.com\/watch\?v=|\.be\/)([a-zA-Z0-9_-]+)(?:&\S*)?)\)/g;
                htmlContent = htmlContent.replace(videoRegex, (match, url, videoId) => {
                    return `<iframe width="100%" height="315" src="https://www.youtube.com/embed/${videoId}" frameborder="0" allowfullscreen></iframe>`;
                });
                
                // Handle thumbnail for both preview and full post
                let thumbnailImg = '';
                if (post.thumbnail) {
                    // If post has a thumbnail URL, use it
                    thumbnailImg = `<img src="${post.thumbnail}" alt="Thumbnail">`;
                } else {
                    // Otherwise extract the first image from content
                    thumbnailImg = this.extractThumbnail(htmlContent);
                }
                
                // If this is a preview, show only the first ~200 characters of content
                let previewContent = htmlContent;
                let hasMoreContent = false;
                
                if (isPreview) {
                    // Create preview with thumbnail and properly formatted HTML content
                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = htmlContent;
                    
                    // Get the text content for length check only
                    const textContent = tempDiv.textContent;
                    
                    // Determine if the content is long enough to need a "Read More" button
                    hasMoreContent = textContent.length > 200;
                    
                    // Get a truncated version of the HTML content (not just text)
                    let previewHtmlContent = htmlContent;
                    if (hasMoreContent) {
                        // This approach keeps the HTML but truncates it safely
                        // First create a container and add the HTML
                        const container = document.createElement('div');
                        container.innerHTML = htmlContent;
                        
                        // Then extract approximately the first 200 chars worth of content
                        let charCount = 0;
                        let contentNodes = Array.from(container.childNodes);
                        let truncatedNodes = [];
                        
                        for (let node of contentNodes) {
                            if (charCount >= 200) break;
                            
                            if (node.nodeType === Node.TEXT_NODE) {
                                // For text nodes, add them directly if they're short enough
                                if (node.textContent.length + charCount <= 200) {
                                    truncatedNodes.push(node.cloneNode(true));
                                    charCount += node.textContent.length;
                                } else {
                                    // Truncate the text
                                    const truncText = document.createTextNode(
                                        node.textContent.slice(0, 200 - charCount)
                                    );
                                    truncatedNodes.push(truncText);
                                    charCount = 200;
                                    break;
                                }
                            } else if (node.nodeType === Node.ELEMENT_NODE) {
                                // For element nodes, use their outerHTML
                                truncatedNodes.push(node.cloneNode(true));
                                charCount += node.textContent.length;
                            }
                        }
                        
                        // Create a new container for the truncated content
                        const truncContainer = document.createElement('div');
                        truncatedNodes.forEach(node => truncContainer.appendChild(node));
                        previewHtmlContent = truncContainer.innerHTML + '...';
                    }
                    
                    // Create preview with thumbnail and properly formatted HTML content
                    const previewHtml = `
                        <div class="post-preview">
                            ${thumbnailImg ? `<div class="post-thumbnail">${thumbnailImg}</div>` : ''}
                            <div class="post-preview-text">
                                ${previewHtmlContent}
                            </div>
                        </div>
                    `;
                    
                    previewContent = previewHtml;
                }
                
                // Add pinned indicator if post is pinned
                let pinnedIndicator = '';
                if (post.pinned) {
                    pinnedIndicator = '<div class="pinned-indicator">📌 Pinned Post</div>';
                }
                
                // Construct the post HTML
                let postHTML = `
                    <div class="post-header">
                        ${pinnedIndicator}
                        <h2 class="post-title" data-post-id="${postId}">${post.title}</h2>
                        <h3 class="post-subtitle">${post.subtitle}</h3>
                        <div class="post-date">${dateDisplay}</div>
                    </div>
                `;
                
                // For full post view, add thumbnail at the top in the middle
                if (!isPreview && thumbnailImg) {
                    postHTML += `
                        <div class="post-thumbnail-full">
                            ${thumbnailImg}
                        </div>
                    `;
                }
                
                postHTML += `
                    <div class="post-content">
                        ${isPreview ? previewContent : htmlContent}
                    </div>
                `;
                
                // Combine "Read More" button and "Add a comment" into a single row
                if (isPreview) {
                    postHTML += `<div class="action-buttons-container">`;
                    
                    // Add "Read More" button if content is long enough
                    if (hasMoreContent) {
                        postHTML += `
                            <button class="btn read-more-btn" data-post-id="${postId}">Read More</button>
                        `;
                    }
                    
                    // Add comment button next to Read More or by itself if no Read More
                    postHTML += `
                        <button class="btn comment-btn" data-post-id="${postId}">Add a comment</button>
                    </div>
                    `;
                } else {
                    // For full posts, add comments section
                    postHTML += `
                        <div class="comments-section">
                            <h3 class="comments-title">Comments</h3>
                            <div class="comments-list" id="comments-${postId}">
                                <!-- Comments will be loaded here -->
                            </div>
                            <form class="comment-form" data-post-id="${postId}">
                                <input type="text" placeholder="Your Name (optional)" class="comment-name">
                                <textarea placeholder="Write your comment here... Markdown supported." class="comment-text" required></textarea>
                                <button type="submit" class="btn">Post Comment</button>
                            </form>
                        </div>
                    `;
                }
                
                if (isPreview) {
                    // Add a promise to load top comments later
                    setTimeout(() => {
                        this.showTopComments(postId, postDiv);
                    }, 100);
                }
                
                postDiv.innerHTML = postHTML;
                
                if (Model.auth.getCurrentUser()) {
                    const adminActions = document.createElement('div');
                    adminActions.className = 'admin-actions';
                    adminActions.style.marginTop = '20px';
                    adminActions.style.textAlign = 'right';
                    
                    // Add edit button
                    const editButton = document.createElement('button');
                    editButton.className = 'btn edit-post-btn';
                    editButton.setAttribute('data-post-id', postId);
                    editButton.textContent = 'Edit Post';
                    
                    // Add toggle pin button
                    const togglePinButton = document.createElement('button');
                    togglePinButton.className = 'btn toggle-pin-btn';
                    togglePinButton.setAttribute('data-post-id', postId);
                    togglePinButton.textContent = post.pinned ? 'Unpin Post' : 'Pin Post';
                    
                    const deleteButton = document.createElement('button');
                    deleteButton.className = 'btn delete-post-btn';
                    deleteButton.setAttribute('data-post-id', postId);
                    deleteButton.textContent = 'Delete Post';
                    
                    adminActions.appendChild(editButton);
                    adminActions.appendChild(togglePinButton);
                    adminActions.appendChild(deleteButton);
                    
                    // For previews, add to action-buttons-container
                    if (isPreview) {
                        const actionsContainer = postDiv.querySelector('.action-buttons-container');
                        if (actionsContainer) {
                            actionsContainer.appendChild(adminActions);
                        } else {
                            postDiv.appendChild(adminActions);
                        }
                    } else {
                        postDiv.appendChild(adminActions);
                    }
                }
            
                return postDiv;
            },

                    // Add these functions to the View.posts object
            createEditForm: function() {
                const editPanel = document.createElement('div');
                editPanel.className = 'admin-panel edit-panel';
                editPanel.id = 'edit-post-panel';
                editPanel.style.display = 'none';
                
                const form = document.createElement('form');
                form.id = 'edit-post-form';
                form.className = 'post-form';
                
                form.innerHTML = `
                    <h2 class="admin-title">Edit Post</h2>
                    <input type="hidden" id="edit-post-id">
                    
                    <label for="edit-post-title">Title:</label>
                    <input type="text" id="edit-post-title" required>
                    
                    <label for="edit-post-subtitle">Subtitle:</label>
                    <input type="text" id="edit-post-subtitle" required>
                    
                    <label for="edit-post-thumbnail">Thumbnail URL (optional):</label>
                    <input type="text" id="edit-post-thumbnail" placeholder="https://example.com/image.jpg">
                    
                    <label for="edit-post-content">Content (Markdown supported):</label>
                    <textarea id="edit-post-content" placeholder="Write your post here. Markdown supported. The first image will be used as thumbnail if no URL is provided. For YouTube videos, use: ![video](youtube-url)" required></textarea>
                    
                    <label for="edit-post-pinned" class="checkbox-label">
                        <input type="checkbox" id="edit-post-pinned"> Pin this post to the top
                    </label>
                    
                    <div class="form-actions">
                        <button type="button" id="cancel-edit-btn" class="btn">Cancel</button>
                        <button type="submit" class="btn">Update Post</button>
                    </div>
                `;
                
                editPanel.appendChild(form);
                return editPanel;
            },

            populateEditForm: function(post) {
                document.getElementById('edit-post-id').value = post.id;
                document.getElementById('edit-post-title').value = post.title;
                document.getElementById('edit-post-subtitle').value = post.subtitle;
                document.getElementById('edit-post-thumbnail').value = post.thumbnail || '';
                document.getElementById('edit-post-content').value = post.content;
                document.getElementById('edit-post-pinned').checked = post.pinned || false;
            },

            showEditForm: function(post) {
                // Hide create post form if visible
                View.elements.adminPanel.style.display = 'none';
                
                // Populate and show edit form
                this.populateEditForm(post);
                
                // Make sure the edit panel exists in the DOM
                let editPanel = document.getElementById('edit-post-panel');
                if (!editPanel) {
                    editPanel = this.createEditForm();
                    document.querySelector('main').insertBefore(editPanel, View.elements.musicPostsContainer);
                }
                
                // Remove any existing event listeners to avoid duplicates
                const editForm = document.getElementById('edit-post-form');
                const newEditForm = editForm.cloneNode(true);
                if (editForm.parentNode) {
                    editForm.parentNode.replaceChild(newEditForm, editForm);
                }
                
                // Add event listeners with the correct context
                newEditForm.addEventListener('submit', function(e) {
                    e.preventDefault();
                    Controller.handleEditPost(e);
                });
                
                const cancelButton = document.getElementById('cancel-edit-btn');
                if (cancelButton) {
                    cancelButton.addEventListener('click', function() {
                        View.posts.hideEditForm();
                    });
                }
                
                editPanel.style.display = 'block';
                
                // Scroll to edit form
                editPanel.scrollIntoView({ behavior: 'smooth' });
            },

            hideEditForm: function() {
                const editPanel = document.getElementById('edit-post-panel');
                if (editPanel) {
                    editPanel.style.display = 'none';
                }
                
                View.elements.adminPanel.style.display = 'block';
            },

            renderPaginated: function(paginationData) {
                const { posts, currentPage, totalPages } = paginationData;
                const container = View.elements.musicPostsContainer;
                
                // Remove loading indicator if it exists
                const loadingIndicator = document.getElementById('loading-indicator');
                if (loadingIndicator) {
                    loadingIndicator.remove();
                }
                
                // Clear container
                container.innerHTML = '';
                
                if (posts.length === 0) {
                    // Show message when no posts are available
                    const noPostsMessage = document.createElement('div');
                    noPostsMessage.className = 'post';
                    noPostsMessage.innerHTML = `
                        <div class="post-header">
                            <h2 class="post-title">No Posts Yet</h2>
                            <h3 class="post-subtitle">Stay tuned for upcoming music content</h3>
                        </div>
                        <div class="post-content">
                            <p>The admin hasn't added any music posts yet. Check back soon!</p>
                        </div>
                    `;
                    container.appendChild(noPostsMessage);
                    return;
                }
                
                // Create all post elements with fade-in effect
                const fragment = document.createDocumentFragment();
                posts.forEach(post => {
                    const postElement = this.createPostElement(post.id, post);
                    postElement.style.opacity = '0';
                    fragment.appendChild(postElement);
                });
                
                // Add all content to the container
                container.appendChild(fragment);
                
                // Add pagination controls if more than one page
                if (totalPages > 1) {
                    const paginationElement = this.createPaginationElement(currentPage, totalPages);
                    container.appendChild(paginationElement);
                }
                
                // Fade in posts sequentially with a small delay between each
                const postElements = container.querySelectorAll('.post:not(.pagination-container)');
                postElements.forEach((element, index) => {
                    setTimeout(() => {
                        element.style.opacity = '1';
                    }, 50 * index);
                });
            },
            
            createPaginationElement: function(currentPage, totalPages) {
                const paginationDiv = document.createElement('div');
                paginationDiv.className = 'pagination-container post';
                
                let paginationHTML = '<div class="pagination">';
                
                // Previous button
                if (currentPage > 1) {
                    paginationHTML += `<button class="btn pagination-btn prev-page" data-page="${currentPage - 1}">Previous</button>`;
                }
                
                // Page numbers - show a reasonable number of pages
                const maxVisiblePages = 5;
                let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
                let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);
                
                // Adjust if we're near the end
                if (endPage - startPage + 1 < maxVisiblePages) {
                    startPage = Math.max(1, endPage - maxVisiblePages + 1);
                }
                
                // First page + ellipsis if needed
                if (startPage > 1) {
                    paginationHTML += `<button class="btn pagination-number" data-page="1">1</button>`;
                    if (startPage > 2) {
                        paginationHTML += `<span class="pagination-ellipsis">...</span>`;
                    }
                }
                
                // Page numbers
                for (let i = startPage; i <= endPage; i++) {
                    if (i === currentPage) {
                        paginationHTML += `<span class="pagination-number current">${i}</span>`;
                    } else {
                        paginationHTML += `<button class="btn pagination-number" data-page="${i}">${i}</button>`;
                    }
                }
                
                // Last page + ellipsis if needed
                if (endPage < totalPages) {
                    if (endPage < totalPages - 1) {
                        paginationHTML += `<span class="pagination-ellipsis">...</span>`;
                    }
                    paginationHTML += `<button class="btn pagination-number" data-page="${totalPages}">${totalPages}</button>`;
                }
                
                // Next button
                if (currentPage < totalPages) {
                    paginationHTML += `<button class="btn pagination-btn next-page" data-page="${currentPage + 1}">Next</button>`;
                }
                
                paginationHTML += '</div>';
                paginationDiv.innerHTML = paginationHTML;
                
                return paginationDiv;
            },

            showTopComments: async function(postId, postElement) {
                try {
                    // Only fetch top-level comments (where parentId is null)
                    let topLikedComments = await Model.comments.getTopLikedComments(postId, 3);
                    
                    // Filter out deleted comments
                    topLikedComments = topLikedComments.filter(comment => 
                        !comment.deletedByAuthor && !comment.deletedByAdmin && comment.parentId === null
                    );
                    
                    // If there are fewer than 3 liked comments, get recent comments to fill the gap
                    let recentComments = [];
                    if (topLikedComments.length < 3) {
                        // getRecentComments already only gets top-level comments
                        recentComments = await Model.comments.getRecentComments(postId, 3 - topLikedComments.length);
                        
                        // Filter out deleted comments from recent comments too
                        recentComments = recentComments.filter(comment => 
                            !comment.deletedByAuthor && !comment.deletedByAdmin
                        );
                        
                        // Make sure we don't duplicate comments
                        if (topLikedComments.length > 0) {
                            const topLikedIds = topLikedComments.map(c => c.id);
                            recentComments = recentComments.filter(c => !topLikedIds.includes(c.id));
                        }
                    }
                    
                    // Combine the comments
                    const combinedComments = [...topLikedComments, ...recentComments];
                    
                    if (combinedComments.length === 0) {
                        return;
                    }
                    
                    // Get user IP for like button states
                    let userIp = null;
                    try {
                        const ipResponse = await fetch('https://api.ipify.org?format=json');
                        const ipData = await ipResponse.json();
                        userIp = ipData.ip;
                    } catch (error) {
                        console.error('Could not get user IP:', error);
                    }
                    
                    // Create a container for preview comments
                    const commentsSection = document.createElement('div');
                    commentsSection.className = 'top-comments-section';
                    commentsSection.innerHTML = `
                        <h4 class="top-comments-title">
                            ${topLikedComments.length > 0 ? 'Popular Comments' : 'Recent Comments'}
                        </h4>
                    `;
                    
                    const commentsList = document.createElement('div');
                    commentsList.className = 'top-comments-list';
                    
                    // Add each comment to the list
                    combinedComments.filter(comment => comment.parentId === null).forEach(comment => {
                        // Create a simplified version of the comment for preview
                        const commentElement = this.createPreviewCommentElement(postId, comment, userIp);
                        commentsList.appendChild(commentElement);
                    });
                    
                    commentsSection.appendChild(commentsList);
                    
                    // Add a link to view all comments
                    const viewAllLink = document.createElement('div');
                    viewAllLink.className = 'view-all-comments';
                    viewAllLink.innerHTML = `
                        <button class="btn comment-btn" data-post-id="${postId}">
                            View All Comments
                        </button>
                    `;
                    commentsSection.appendChild(viewAllLink);
                    
                    // Add the comments section to the post element
                    const postActions = postElement.querySelector('.post-actions') || 
                                       postElement.querySelector('.preview-comment-link');
                    
                    if (postActions) {
                        postActions.parentNode.insertBefore(commentsSection, postActions.nextSibling);
                    } else {
                        // If no post actions, add to the end of the post
                        postElement.appendChild(commentsSection);
                    }
                } catch (error) {
                    console.error('Error loading preview comments:', error);
                }
            },

            createPreviewCommentElement: function(postId, comment, userIp = null) {
                const commentDiv = document.createElement('div');
                commentDiv.className = 'comment preview-comment';
                commentDiv.setAttribute('data-comment-id', comment.id);
                
                // Format timestamp
                let dateDisplay = 'Just now';
                if (comment.timestamp) {
                    const date = comment.timestamp.toDate();
                    dateDisplay = date.toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric'
                    });
                }
                
                const authorName = comment.authorName ? comment.authorName : 'Anonymous';
                
                // Truncate comment content if it's too long
                let content = comment.content;
                if (content.length > 100) {
                    content = content.substring(0, 100) + '...';
                }
                
                const htmlContent = marked.parse(content);
                
                // Check if the current user is the author or has already liked
                const isAuthor = userIp && comment.authorIp === userIp;
                const hasLiked = userIp && comment.likedIps && comment.likedIps.includes(userIp);
                const likesCount = comment.likes || 0;
                
                commentDiv.innerHTML = `
                    <div class="comment-header">
                        <span class="comment-author">${authorName}</span>
                        <span class="comment-date">${dateDisplay}</span>
                    </div>
                    <div class="comment-content preview">
                        ${htmlContent}
                    </div>
                    <div class="comment-actions">
                        <span class="likes-count">${likesCount} ${likesCount === 1 ? 'like' : 'likes'}</span>
                    </div>
                `;
                
                return commentDiv;
            },
            
            // Add this helper method to extract thumbnails
            extractThumbnail: function(htmlContent) {
                // Try to find the first image in the content
                const imgMatch = htmlContent.match(/<img[^>]+src="([^"]+)"[^>]*>/);
                return imgMatch ? `<img src="${imgMatch[1]}" alt="Thumbnail">` : '';
            },

            showAllPosts: function() {
                const container = View.elements.musicPostsContainer;
                
                // Remove any full posts
                const fullPosts = container.querySelectorAll('.post-full');
                fullPosts.forEach(post => {
                    post.remove();
                });
                
                // Show all preview posts
                const allPosts = container.querySelectorAll('.post');
                allPosts.forEach(post => {
                    post.style.display = 'block';
                });
            },

            showFullPost: function(postId) {
                const container = View.elements.musicPostsContainer;
                
                // Check if we're already displaying this post to prevent flashing
                const existingFullPost = container.querySelector(`.post-full[data-post-id="${postId}"]`);
                if (existingFullPost) {
                    // If this post is already being displayed, just scroll to it
                    existingFullPost.scrollIntoView({ behavior: 'smooth' });
                    return;
                }
                
                // Create a loading indicator but don't add it to the DOM yet
                const loadingIndicator = document.createElement('div');
                loadingIndicator.id = 'post-loading-indicator';
                loadingIndicator.className = 'post loading-indicator';
                loadingIndicator.innerHTML = '<p>Loading post... <span class="blink">|</span></p>';
                
                // Variable to store the loading timeout
                let loadingTimeout;
                
                // Clear container content with a smooth fade
                const allPosts = container.querySelectorAll('.post');
                allPosts.forEach(post => {
                    post.style.opacity = '0';
                    post.style.transition = 'opacity 0.3s';
                });
                
                // Wait for fade out animation before clearing content
                setTimeout(() => {
                    container.innerHTML = '';
                    
                    // Set a timeout to add the loading indicator after 1 second
                    loadingTimeout = setTimeout(() => {
                        container.appendChild(loadingIndicator);
                    }, 1000);
                    
                    // Get the post data and create a full post
                    Model.posts.getPost(postId).then(post => {
                        // Clear the loading timeout if it hasn't triggered yet
                        if (loadingTimeout) {
                            clearTimeout(loadingTimeout);
                        }
                        
                        // Remove loading indicator if it was added
                        if (loadingIndicator.parentNode) {
                            container.removeChild(loadingIndicator);
                        }
                        
                        // Create a full post element (passing false to indicate it's not a preview)
                        const fullPostElement = this.createPostElement(postId, post, false);
                        fullPostElement.classList.add('post-full');
                        fullPostElement.style.opacity = '0';
                        fullPostElement.style.transition = 'opacity 0.5s';
                        
                        // Add a back button
                        const backButton = document.createElement('button');
                        backButton.className = 'btn back-btn';
                        backButton.textContent = 'Back to All Posts';
                        backButton.addEventListener('click', (e) => {
                            e.preventDefault();
                            // Use the unified navigation function for consistency
                            Controller.navigateToAllPosts(fullPostElement);
                        });
                        
                        fullPostElement.insertBefore(backButton, fullPostElement.firstChild);
                        
                        // Add the full post to the container
                        container.innerHTML = '';
                        container.appendChild(fullPostElement);
                        
                        // Fade in the full post
                        setTimeout(() => {
                            fullPostElement.style.opacity = '1';
                        }, 50);
                        
                        // Load comments for the full post
                        Controller.loadComments(postId);
                        
                        // Update URL hash to include the post ID for direct linking and browser back button support
                        if (window.location.hash !== `#${postId}`) {
                            history.pushState(null, "", `#${postId}`);
                        }
                    }).catch(error => {
                        // Clear the loading timeout if it hasn't triggered yet
                        if (loadingTimeout) {
                            clearTimeout(loadingTimeout);
                        }
                        
                        // Remove loading indicator if it was added
                        if (loadingIndicator.parentNode) {
                            container.removeChild(loadingIndicator);
                        }
                        
                        View.showError('Error loading post: ' + error.message);
                        Controller.loadPosts();
                    });
                }, 300);
            },
            
            
            createDefaultPost: function() {
                const postDiv = document.createElement('div');
                postDiv.className = 'post';
                postDiv.innerHTML = `
                    <div class="post-header">
                        <h2 class="post-title">Welcome to My Music Page!</h2>
                        <h3 class="post-subtitle">A place to share the songs I enjoy</h3>
                        <div class="post-date">March 18, 2025</div>
                    </div>
                    <div class="post-content">
                        <p>This is where I'll be sharing music I like and thoughts about different artists, albums, and songs.</p>
                        <p>Stay tuned for upcoming posts, and feel free to leave comments!</p>
                    </div>
                    <div class="comments-section">
                        <h3 class="comments-title">Comments</h3>
                        <div class="comments-list" id="comments-welcome">
                            <!-- Comments will appear here -->
                        </div>
                        <form class="comment-form" data-post-id="welcome">
                            <input type="text" placeholder="Your Name (optional)" class="comment-name">
                            <textarea placeholder="Write your comment here... Markdown supported." class="comment-text" required></textarea>
                            <button type="submit" class="btn">Post Comment</button>
                        </form>
                    </div>
                `;
                return postDiv;
            },
            
            clearPostForm: function() {
                View.elements.postForm.reset();
            }
        },
        
        // Comments rendering
        comments: {
            renderComments: function(postId, comments, userIp = null, threadView = false, newCommentId = null) {
                const container = document.getElementById(`comments-${postId}`);
                
                if (!container) return;
                
                if (comments.length === 0) {
                    container.innerHTML = '<p>No comments yet. Be the first to comment!</p>';
                    return;
                }
                
                // Don't clear existing comments if we're in thread view or adding a new comment
                if (!threadView && !newCommentId) {
                    container.innerHTML = '';
                }
                
                // Filter top-level comments if not in thread view
                const displayComments = threadView ? comments : comments.filter(c => c.parentId === null);
                
                // Sort comments by timestamp, newest first for top level
                const sortedComments = [...displayComments].sort((a, b) => {
                    // If one is the new comment, it should come first
                    if (a.id === newCommentId) return -1;
                    if (b.id === newCommentId) return 1;
                    
                    // Otherwise sort by timestamp
                    if (!a.timestamp || !b.timestamp) return 0;
                    return b.timestamp.seconds - a.timestamp.seconds;
                });
                
                // First, remove any existing comments if we're refreshing
                if (newCommentId && !threadView) {
                    // Keep existing comments container but clear its content
                    container.innerHTML = '';
                }
                
                // Now add all comments
                sortedComments.forEach(comment => {
                    const isNewComment = comment.id === newCommentId;
                    const commentElement = this.createCommentElement(postId, comment.id, comment, false, userIp);
                    
                    if (isNewComment) {
                        commentElement.classList.add('new-comment');
                    }
                    
                    container.appendChild(commentElement);
                });
            },

            renderThread: function(postId, threadData, userIp = null) {
                const container = document.getElementById(`comments-${postId}`);
                
                if (!container) return;
                
                // Clear container
                container.innerHTML = '';
                
                // Add back button
                const backButton = document.createElement('button');
                backButton.className = 'btn back-btn thread-back-btn';
                backButton.textContent = 'Back to all comments';
                backButton.addEventListener('click', () => {
                    // Exit thread view and show all comments
                    Controller.loadComments(postId);
                });
                container.appendChild(backButton);
                
                // Add the main comment
                const mainCommentElement = View.comments.createCommentElement(
                    postId, 
                    threadData.comment.id, 
                    threadData.comment, 
                    false, 
                    userIp
                );
                container.appendChild(mainCommentElement);
                
                // Group replies by parent ID for recursive rendering
                const repliesByParent = {};
                threadData.replies.forEach(reply => {
                    if (!repliesByParent[reply.parentId]) {
                        repliesByParent[reply.parentId] = [];
                    }
                    repliesByParent[reply.parentId].push(reply);
                });
                
                // Recursively render replies
                this.renderNestedReplies(postId, threadData.comment.id, repliesByParent, mainCommentElement, userIp);
            },

            renderNestedReplies: function(postId, parentId, repliesByParent, parentElement, userIp = null, depth = 0, newReplyId = null) {
                const replies = repliesByParent[parentId] || [];
                if (replies.length === 0) return;
                
                // Create a container for replies
                const repliesDiv = document.createElement('div');
                repliesDiv.className = 'replies';
                repliesDiv.setAttribute('data-parent-id', parentId);
                repliesDiv.setAttribute('data-depth', depth);
                
                // Add depth-based styling
                if (depth > 0) {
                    repliesDiv.classList.add(`depth-${Math.min(depth, 5)}`);
                }
                
                // Process replies for this parent
                replies.forEach(reply => {
                    // Check if this is the new reply
                    const isNewReply = reply.id === newReplyId;
                    
                    // Create the reply element
                    const replyElement = this.createCommentElement(postId, reply.id, reply, true, userIp);
                    replyElement.classList.add('nested-reply');
                    if (isNewReply) {
                        replyElement.classList.add('new-comment');
                    }
                    replyElement.setAttribute('data-depth', depth + 1);
                    repliesDiv.appendChild(replyElement);
                    
                    // Check if this should show "Continue this thread" instead of nested replies
                    const hasChildren = repliesByParent[reply.id] && repliesByParent[reply.id].length > 0;
                    const isTooDeep = depth >= 3; // Thread continuation threshold
                    
                    if (hasChildren && isTooDeep) {
                        // Add "Continue this thread" button
                        const continueButton = document.createElement('button');
                        continueButton.className = 'btn continue-thread-btn';
                        continueButton.textContent = 'Continue this thread';
                        continueButton.setAttribute('data-comment-id', reply.id);
                        continueButton.setAttribute('data-post-id', postId);
                        continueButton.addEventListener('click', () => {
                            Controller.loadThread(postId, reply.id);
                        });
                        replyElement.appendChild(continueButton);
                    } else if (hasChildren) {
                        // Recursively render child replies, passing along newReplyId
                        this.renderNestedReplies(postId, reply.id, repliesByParent, replyElement, userIp, depth + 1, newReplyId);
                    }
                });
                
                // Add the replies container to the parent element
                parentElement.appendChild(repliesDiv);
            },
            
            renderReplies: function(postId, commentId, replies, parentElement, userIp = null) {
                if (replies.length === 0) return;
                
                // Create a container for all replies to this comment
                const repliesDiv = document.createElement('div');
                repliesDiv.className = 'replies';
                
                // Group replies by level
                const firstLevelReplies = replies.filter(reply => reply.level === 1);
                const secondLevelReplies = replies.filter(reply => reply.level === 2);
                
                // Process first level replies
                firstLevelReplies.forEach(reply => {
                    // Create the reply element with user IP for like button state
                    const replyElement = View.comments.createCommentElement(postId, reply.id, reply, true, userIp);
                    replyElement.classList.add('first-level-reply');
                    repliesDiv.appendChild(replyElement);
                    
                    // Find child replies (second level) that belong to this first level reply
                    const childReplies = secondLevelReplies.filter(r => r.parentId === reply.id);
                    
                    // If there are child replies, create a container for them
                    if (childReplies.length > 0) {
                        const secondLevelContainer = document.createElement('div');
                        secondLevelContainer.className = 'second-level-replies';
                        secondLevelContainer.setAttribute('data-parent-id', reply.id);
                        
                        // Add each child reply to the container
                        childReplies.forEach(childReply => {
                            const childElement = View.comments.createCommentElement(
                                postId, childReply.id, childReply, true, userIp
                            );
                            childElement.classList.add('second-level-reply');
                            secondLevelContainer.appendChild(childElement);
                        });
                        
                        // Add the container after the first level reply
                        replyElement.after(secondLevelContainer);
                    }
                });
                
                // Add all replies to the parent comment
                parentElement.appendChild(repliesDiv);
            },
            
            
            createCommentElement: function(postId, commentId, comment, isReply = false, userIp = null) {
                const commentDiv = document.createElement('div');
                commentDiv.className = 'comment';
                commentDiv.setAttribute('data-comment-id', commentId);
                commentDiv.setAttribute('data-parent-id', comment.parentId || 'null');
                
                if (comment.depth) {
                    commentDiv.setAttribute('data-depth', comment.depth);
                }
            
                // Format timestamp
                let dateDisplay = 'Just now';
                if (comment.timestamp) {
                    const date = comment.timestamp.toDate();
                    dateDisplay = date.toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                    });
                }
            
                const authorName = comment.authorName ? comment.authorName : 'Anonymous';
                
                // Check if comment is deleted
                const isDeleted = comment.deletedByAuthor || comment.deletedByAdmin;
                
                // Determine content based on deleted status
                const commentContent = comment.deletedByAuthor 
                    ? '<em>[Comment deleted by author]</em>' 
                    : (comment.deletedByAdmin 
                        ? '<em>[Comment deleted by admin]</em>' 
                        : marked.parse(comment.content));
                
                const likesCount = comment.likes || 0;
                
                // Check if the current user is the author or has already liked this comment
                const isAuthor = userIp && comment.authorIp === userIp;
                const hasLiked = userIp && comment.likedIps && comment.likedIps.includes(userIp);
                
                // Determine the like button state
                let likeButtonHtml = '';
                if (isAuthor) {
                    likeButtonHtml = `<button class="btn like-btn author-comment" data-post-id="${postId}" data-comment-id="${commentId}" disabled>Your Comment</button>`;
                } else if (hasLiked) {
                    likeButtonHtml = `<button class="btn like-btn already-liked" data-post-id="${postId}" data-comment-id="${commentId}" disabled>Liked</button>`;
                } else {
                    likeButtonHtml = `<button class="btn like-btn" data-post-id="${postId}" data-comment-id="${commentId}">Like</button>`;
                }
            
                // Only show reply button if comment is not deleted
                const replyButtonHtml = isDeleted ? '' : `<button class="btn reply-button" data-comment-id="${commentId}">Reply</button>`;
                
                // Only show delete button if comment is not deleted and user is author or admin
                const isAdmin = Model.auth.getCurrentUser() !== null;
                let deleteButtonHtml = '';
                if (!isDeleted && (isAuthor || isAdmin)) {
                    deleteButtonHtml = `<button class="btn delete-comment-btn" data-post-id="${postId}" data-comment-id="${commentId}">Delete</button>`;
                }
            
                commentDiv.innerHTML = `
                    <div class="comment-header">
                        <span class="comment-author">${authorName}</span>
                        <span class="comment-date">${dateDisplay}</span>
                    </div>
                    <div class="comment-content">
                        ${commentContent}
                    </div>
                    <div class="comment-actions">
                        <span class="likes-count">${likesCount} ${likesCount === 1 ? 'like' : 'likes'}</span>
                        ${likeButtonHtml}
                        ${replyButtonHtml}
                        ${deleteButtonHtml}
                    </div>
                `;
                
                // Only add reply form if comment isn't deleted
                if (!isDeleted) {
                    // Create reply form (hidden by default)
                    const replyForm = document.createElement('form');
                    replyForm.className = 'reply-form';
                    replyForm.style.display = 'none';
                    replyForm.innerHTML = `
                        <input type="text" placeholder="Your Name (optional)" class="comment-name">
                        <textarea placeholder="Write your reply here... Markdown supported." class="comment-text" required></textarea>
                        <div class="reply-form-actions">
                            <button type="button" class="btn cancel-reply-btn">Cancel</button>
                            <button type="submit" class="btn">Post Reply</button>
                        </div>
                    `;
                    
                    // Set data attributes for the reply form
                    replyForm.setAttribute('data-post-id', postId);
                    replyForm.setAttribute('data-parent-id', commentId);
                    
                    // Instead of hard-coding levels, track ancestry using arrays and depth
                    if (comment.ancestors) {
                        replyForm.setAttribute('data-ancestors', JSON.stringify([...comment.ancestors, commentId]));
                    } else {
                        replyForm.setAttribute('data-ancestors', JSON.stringify([commentId]));
                    }
                    
                    replyForm.setAttribute('data-depth', comment.depth ? comment.depth + 1 : 1);
                    
                    commentDiv.appendChild(replyForm);
                }
                
                return commentDiv;
            }
        },
        
        // Tab management
        tabs: {
            switchToTab: function(tabName) {
                View.elements.tabPosts.classList.toggle('active', tabName === 'posts');
                View.elements.tabComments.classList.toggle('active', tabName === 'comments');
                View.elements.postsTab.classList.toggle('active', tabName === 'posts');
                View.elements.commentsTab.classList.toggle('active', tabName === 'comments');
            }
        },
        
        // Error handling
        showError: function(message) {
            alert(message);
        }
    };
    
    /**
     * CONTROLLER
     * Handles user interactions and coordinates between Model and View
     */
    const Controller = {
        currentPage: 1,
        init: function() {
            const firebaseData = Model.init();

            // Generate stars background - fixed function reference
            View.generateStars();

            View.elements.editPostPanel = View.posts.createEditForm();
            document.querySelector('main').insertBefore(View.elements.editPostPanel, View.elements.musicPostsContainer);
            
            // Add this code right after generateStars call
            const marqueeContent = document.querySelector('.marquee-content');
            if (marqueeContent) {
                // Set the content based on animation state
                const animationsDisabled = document.body.classList.contains('animations-disabled');
                if (!animationsDisabled) {
                    // For smooth scrolling when animations are enabled
                    const content = marqueeContent.textContent.trim();
                    marqueeContent.textContent = content + ' • ' + content + ' • ' + content;
                }
            }

            this.setupEventListeners();
            Model.auth.onAuthStateChanged(user => {
                View.auth.updateUI(user);
            });
            if (window.location.hash) {
                const postId = window.location.hash.substring(1);
                View.posts.showFullPost(postId);
            } else {
                this.loadPosts();
            }
            const animationsDisabled = localStorage.getItem('animations-disabled') === 'true';
            if (animationsDisabled) {
                if (marqueeContent) {
                    marqueeContent.textContent = "WELCOME TO MY MUSIC PAGE • DISCOVER SONGS I LIKE • SHARE YOUR THOUGHTS";
                }
                document.body.classList.add('animations-disabled');
                const toggleAnimationsBtn = document.getElementById('toggle-animations-btn');
                if (toggleAnimationsBtn) {
                    toggleAnimationsBtn.textContent = 'Enable Animations';
                }
            }
            this.updateVisitorCounter();
        },
        
        setupEventListeners: function() {
            View.elements.loginBtn.addEventListener('click', () => {
                View.auth.showLoginModal();
            });
            
            View.elements.closeLoginBtn.addEventListener('click', () => {
                View.auth.hideLoginModal();
            });
            
            window.addEventListener('click', (e) => {
                if (e.target === View.elements.loginModal) {
                    View.auth.hideLoginModal();
                }
            });
            
            View.elements.adminLoginForm.addEventListener('submit', this.handleAdminLogin.bind(this));
            View.elements.logoutBtn.addEventListener('click', this.handleLogout.bind(this));
            View.elements.postForm.addEventListener('submit', this.handleCreatePost.bind(this));
            
            document.addEventListener('submit', (e) => {
                if (e.target.classList.contains('comment-form')) {
                    e.preventDefault();
                    this.handleCommentSubmit(e.target);
                } else if (e.target.classList.contains('reply-form')) {
                    e.preventDefault();
                    this.handleReplySubmit(e.target);
                }
            });
            
            document.addEventListener('click', (e) => {
                if (e.target.classList.contains('reply-button')) {
                    e.preventDefault();
                    
                    // Find the comment element
                    const commentElement = e.target.closest('.comment');
                    if (!commentElement) return;
                    
                    // Find the reply form
                    const replyForm = commentElement.querySelector('.reply-form');
                    if (!replyForm) return;
                    
                    // Get the post ID for managing main comment form
                    const postId = replyForm.getAttribute('data-post-id');
                    const mainCommentForm = document.querySelector(`.post-full[data-post-id="${postId}"] .comment-form`);
                    
                    // Check if the form is already visible
                    const isVisible = replyForm.style.display === 'block';
                    
                    // Close all other reply forms first
                    document.querySelectorAll('.reply-form').forEach(form => {
                        form.style.display = 'none';
                        const btn = form.closest('.comment').querySelector('.reply-button');
                        if (btn) btn.classList.remove('active-reply');
                    });
                    
                    // Restore main comment form if we're closing this reply form
                    if (isVisible && mainCommentForm) {
                        mainCommentForm.style.display = 'block';
                        mainCommentForm.classList.remove('hidden');
                        e.target.classList.remove('active-reply');
                        replyForm.style.display = 'none';
                        return;
                    }
                    
                    // Hide main comment form when replying
                    if (mainCommentForm) {
                        mainCommentForm.style.display = 'none';
                        mainCommentForm.classList.add('hidden');
                    }
                    
                    // Show this reply form
                    replyForm.style.display = 'block';
                    e.target.classList.add('active-reply');
                    
                    // Focus on the textarea
                    setTimeout(() => {
                        const textarea = replyForm.querySelector('textarea');
                        if (textarea) textarea.focus();
                    }, 100);
                }
            });

            // Add to setupEventListeners near other document.addEventListener blocks
            document.addEventListener('click', (e) => {
                if (e.target.classList.contains('delete-post-btn')) {
                    e.preventDefault();
                    
                    const postId = e.target.getAttribute('data-post-id');
                    
                    if (confirm('Are you sure you want to delete this post? This action cannot be undone and all comments will be lost.')) {
                        this.handleDeletePost(postId);
                    }
                }
            });
            // Add to setupEventListeners near other document.addEventListener blocks
            document.addEventListener('click', (e) => {
                if (e.target.classList.contains('delete-comment-btn')) {
                    e.preventDefault();
                    
                    const postId = e.target.getAttribute('data-post-id');
                    const commentId = e.target.getAttribute('data-comment-id');
                    
                    if (confirm('Are you sure you want to delete this comment? This action cannot be undone.')) {
                        this.handleDeleteComment(postId, commentId);
                    }
                }
            });

            document.addEventListener('click', function(e) {
                if (e.target.classList.contains('toggle-pin-btn')) {
                    e.preventDefault();
                    
                    const postId = e.target.getAttribute('data-post-id');
                    
                    Controller.handleTogglePin(postId, e.target);
                }
            });

            // Pagination buttons event delegation
            document.addEventListener('click', (e) => {
                if (e.target.classList.contains('pagination-btn') || 
                    e.target.classList.contains('pagination-number')) {
                    
                    e.preventDefault();
                    const page = parseInt(e.target.getAttribute('data-page'));
                    if (!isNaN(page)) {
                        this.loadPosts(page);
                        // Scroll to top of posts
                        View.elements.musicPostsContainer.scrollIntoView({ behavior: 'smooth' });
                    }
                }
            });

            // Get the page title element
            const pageTitle = document.querySelector('.page-title');
            
            if (pageTitle) {
                // Add cursor pointer style to make it visually appear clickable
                pageTitle.style.cursor = 'pointer';
                
                // Add click event listener
                pageTitle.addEventListener('click', function(e) {
                    e.preventDefault();
                    
                    // Check if we're already on the posts list
                    if (!window.location.hash) return;
                    
                    // Force reset navigation state if it seems stuck
                    if (Controller.isNavigating) {
                        Controller.isNavigating = false;
                    }
                    
                    // Get the current full post for transition
                    const fullPost = document.querySelector('.post-full');
                    if (fullPost) {
                        // Small delay to ensure any pending state updates are complete
                        setTimeout(() => {
                            Controller.navigateToAllPosts(fullPost);
                        }, 50);
                    } else {
                        setTimeout(() => {
                            Controller.navigateToAllPosts();
                        }, 50);
                    }
                });
            }

            document.addEventListener('click', (e) => {
                if (e.target.classList.contains('cancel-reply-btn')) {
                    e.preventDefault();
                    
                    // Find the reply form
                    const replyForm = e.target.closest('.reply-form');
                    if (!replyForm) return;
                    
                    // Hide the reply form
                    replyForm.style.display = 'none';
                    
                    // Reset the reply button state
                    const comment = replyForm.closest('.comment');
                    if (comment) {
                        const replyButton = comment.querySelector('.reply-button');
                        if (replyButton) replyButton.classList.remove('active-reply');
                    }
                    
                    // Restore main comment form
                    const postId = replyForm.getAttribute('data-post-id');
                    const mainCommentForm = document.querySelector(`.post-full[data-post-id="${postId}"] .comment-form`);
                    if (mainCommentForm) {
                        mainCommentForm.style.display = 'block';
                        mainCommentForm.classList.remove('hidden');
                    }
                }
            });

            document.addEventListener('click', (e) => {
                if (e.target.classList.contains('continue-thread-btn')) {
                    e.preventDefault();
                    
                    const commentId = e.target.getAttribute('data-comment-id');
                    const postId = e.target.getAttribute('data-post-id');
                    
                    if (commentId && postId) {
                        Controller.loadThread(postId, commentId);
                    }
                }
            });
            

            document.addEventListener('click', function(e) {
                if (e.target.classList.contains('back-btn')) {
                    e.preventDefault();
                    
                    // Force reset navigation state if it seems stuck
                    if (Controller.isNavigating) {
                        Controller.isNavigating = false;
                    }
                    
                    // Find the full post container
                    const fullPost = e.target.closest('.post-full');
                    if (fullPost) {
                        // Small delay to ensure any pending state updates are complete
                        setTimeout(() => {
                            Controller.navigateToAllPosts(fullPost);
                        }, 50);
                    }
                }
            });

            document.addEventListener('click', (e) => {
                if (e.target.classList.contains('edit-post-btn')) {
                    e.preventDefault();
                    const postId = e.target.getAttribute('data-post-id');
                    this.handleEditPostClick(postId);
                }
            });

            document.addEventListener('click', (e) => {
                // Handle multiple post-related clicks in one listener with a single check
                const target = e.target;
                
                // Common post actions like read more, view post, comment
                if (target.classList.contains('read-more-btn') || 
                    target.classList.contains('post-title') || 
                    target.classList.contains('comment-btn')) {
                    
                    e.preventDefault();
                    
                    // Get the post ID from the clicked element
                    let postId;
                    if (target.hasAttribute('data-post-id')) {
                        postId = target.getAttribute('data-post-id');
                    } else {
                        // Find closest parent with post ID
                        const postElement = target.closest('[data-post-id]');
                        if (postElement) {
                            postId = postElement.getAttribute('data-post-id');
                        }
                    }
                    
                    if (!postId) return;
                    
                    // Check if current hash already points to this post to avoid duplicate loads
                    if (window.location.hash === `#${postId}`) {
                        // Just scroll to relevant part if already on this post
                        if (target.classList.contains('comment-btn')) {
                            const commentForm = document.querySelector(`.post-full[data-post-id="${postId}"] .comment-form`);
                            if (commentForm) {
                                commentForm.scrollIntoView({ behavior: 'smooth' });
                                // Focus on textarea for better UX
                                setTimeout(() => {
                                    const textarea = commentForm.querySelector('textarea');
                                    if (textarea) textarea.focus();
                                }, 500);
                            }
                        }
                        return;
                    }
                    
                    // Smooth transition to post view
                    View.posts.showFullPost(postId);
                    
                    // Additional handling for comment button click
                    if (target.classList.contains('comment-btn')) {
                        // Scroll to comment form after post loads
                        setTimeout(() => {
                            const commentForm = document.querySelector(`.post-full[data-post-id="${postId}"] .comment-form`);
                            if (commentForm) {
                                commentForm.scrollIntoView({ behavior: 'smooth' });
                                // Focus on textarea for better UX
                                setTimeout(() => {
                                    const textarea = commentForm.querySelector('textarea');
                                    if (textarea) textarea.focus();
                                }, 500);
                            }
                        }, 800); // Wait for post to fully load and render
                    }
                }
            });
            
            if (window.location.hash) {
                const postId = window.location.hash.substring(1);
                View.posts.showFullPost(postId);
            }
            
            // Handle hash changes
            window.addEventListener('hashchange', function() {
                if (window.location.hash) {
                    const postId = window.location.hash.substring(1);
                    View.posts.showFullPost(postId);
                } else {
                    Controller.loadPosts();
                }
            });
            
            document.addEventListener('click', (e) => {
                if (e.target.classList.contains('like-btn')) {
                    e.preventDefault();
                    const postId = e.target.getAttribute('data-post-id');
                    const commentId = e.target.getAttribute('data-comment-id');
                    this.handleLikeComment(postId, commentId, e.target);
                }
            });

            // Replace the current popstate event handler with this one:
            // Replace the popstate event handler with this completely rewritten version
            // Update the popstate event handler with better state management
            window.addEventListener('popstate', function(event) {
                // Force reset if navigation seems stuck
                if (Controller.isNavigating) {
                    if (Controller._popstateTimeoutId) {
                        clearTimeout(Controller._popstateTimeoutId);
                    }
                    
                    Controller._popstateTimeoutId = setTimeout(() => {
                        Controller.isNavigating = false;
                    }, 100);
                    return;
                }
                
                Controller.isNavigating = true;
                
                // Set a safety timeout to reset navigation flag
                if (Controller._popstateTimeoutId) {
                    clearTimeout(Controller._popstateTimeoutId);
                }
                Controller._popstateTimeoutId = setTimeout(() => {
                    Controller.isNavigating = false;
                }, 1500);
                
                const fullPost = document.querySelector('.post-full');
                
                try {
                    if (fullPost && !window.location.hash) {
                        // We're going back from a post to the list view
                        Controller.navigateToAllPosts(fullPost);
                    } else {
                        // Any other navigation type
                        if (window.location.hash) {
                            const postId = window.location.hash.substring(1);
                            View.posts.showFullPost(postId);
                            // Reset navigation flag after routing to post
                            setTimeout(() => {
                                Controller.isNavigating = false;
                                if (Controller._popstateTimeoutId) {
                                    clearTimeout(Controller._popstateTimeoutId);
                                    Controller._popstateTimeoutId = null;
                                }
                            }, 100);
                        } else {
                            // Use the unified navigation method
                            Controller.navigateToAllPosts();
                        }
                    }
                } catch (error) {
                    console.error('Error handling popstate:', error);
                    // Ensure flag is reset on error
                    Controller.isNavigating = false;
                    if (Controller._popstateTimeoutId) {
                        clearTimeout(Controller._popstateTimeoutId);
                        Controller._popstateTimeoutId = null;
                    }
                }
            });

            const toggleAnimationsBtn = document.getElementById('toggle-animations-btn');
            // Replace the existing toggle animations button event handler
            // Replace the animation toggle button handler
            if (toggleAnimationsBtn) {
                toggleAnimationsBtn.addEventListener('click', function() {
                    const body = document.body;
                    const isDisabled = body.classList.toggle('animations-disabled');
                    
                    // Update button text
                    this.textContent = isDisabled ? 'Enable Animations' : 'Disable Animations';
                    
                    // Save the preference to localStorage
                    localStorage.setItem('animations-disabled', isDisabled);
                    
                    const marqueeContent = document.querySelector('.marquee-content');
                    if (marqueeContent) {
                        if (isDisabled) {
                            // When disabling, just change to single text
                            marqueeContent.textContent = "WELCOME TO MY MUSIC PAGE • DISCOVER SONGS I LIKE • SHARE YOUR THOUGHTS";
                        } else {
                            // When re-enabling, reset animation completely to match initial page load
                            resetMarqueeAnimation();
                        }
                    }
                });
            }
        },

        handleLikeComment: async function(postId, commentId, button) {
            try {
                const result = await Model.comments.likeComment(postId, commentId);
                
                // If user already liked or is author, show appropriate message
                if (result && result.alreadyLiked) {
                    if (result.isAuthor) {
                        button.disabled = true;
                        button.classList.add('author-comment');
                        button.textContent = 'Your Comment';
                        return;
                    } else {
                        button.disabled = true;
                        button.classList.add('already-liked');
                        button.textContent = 'Liked';
                        return;
                    }
                }
                
                // Update the like count display
                const likesCountElement = button.previousElementSibling;
                let currentLikes = parseInt(likesCountElement.textContent);
                if (isNaN(currentLikes)) {
                    currentLikes = 0;
                }
                currentLikes++;
                likesCountElement.textContent = `${currentLikes} ${currentLikes === 1 ? 'like' : 'likes'}`;
                
                // Disable the button after liking and style it
                button.disabled = true;
                button.classList.add('already-liked');
                button.textContent = 'Liked';
            } catch (error) {
                View.showError('Error liking comment: ' + error.message);
            }
        },

        handleTogglePin: async function(postId, button) {
            try {
                const post = await Model.posts.getPost(postId);
                
                // Toggle the pinned status
                await Model.posts.update(postId, {
                    title: post.title,
                    subtitle: post.subtitle,
                    content: post.content,
                    thumbnail: post.thumbnail || '',
                    pinned: !post.pinned
                });
                
                // Update button text based on the new pinned status (opposite of current)
                button.textContent = !post.pinned ? 'Unpin Post' : 'Pin Post';
                
                // Reload to reflect the change
                if (window.location.hash === `#${postId}`) {
                    // If we're viewing the post directly, reload it
                    View.posts.showFullPost(postId);
                } else {
                    // Otherwise reload the full posts list
                    this.loadPosts();
                }
                
                View.showError(post.pinned ? 'Post unpinned successfully!' : 'Post pinned successfully!');
            } catch (error) {
                View.showError('Error toggling pin status: ' + error.message);
            }
        },

        // Add to Controller object
        handleDeletePost: async function(postId) {
            try {
                await Model.posts.deletePost(postId);
                
                // Navigate back to all posts
                window.location.hash = '';
                this.loadPosts();
                View.showError('Post deleted successfully');
            } catch (error) {
                View.showError('Error deleting post: ' + error.message);
            }
        },
                
        handleAdminLogin: async function(e) {
            e.preventDefault();
            
            const email = document.getElementById('admin-email').value;
            const password = document.getElementById('admin-password').value;
            
            try {
                await Model.auth.login(email, password);
                View.auth.hideLoginModal();
                View.auth.clearLoginForm();
            } catch (error) {
                View.showError('Login failed: ' + error.message);
            }
        },
        
        handleLogout: async function() {
            try {
                await Model.auth.logout();
            } catch (error) {
                View.showError('Error signing out: ' + error.message);
            }
        },

        handleEditPostClick: async function(postId) {
            try {
                const post = await Model.posts.getPost(postId);
                View.posts.showEditForm(post);
            } catch (error) {
                View.showError('Error loading post for editing: ' + error.message);
            }
        },
        
        handleEditPost: async function(e) {
            e.preventDefault();
            
            const postId = document.getElementById('edit-post-id').value;
            const title = document.getElementById('edit-post-title').value;
            const subtitle = document.getElementById('edit-post-subtitle').value;
            const content = document.getElementById('edit-post-content').value;
            const thumbnail = document.getElementById('edit-post-thumbnail').value;
            const pinned = document.getElementById('edit-post-pinned').checked;
            
            // Validate inputs
            if (!title.trim() || !subtitle.trim() || !content.trim()) {
                View.showError('Please fill out all required fields');
                return;
            }
            
            // Show loading state on button
            const submitButton = e.target.querySelector('button[type="submit"]');
            const originalButtonText = submitButton.textContent;
            submitButton.textContent = 'Updating...';
            submitButton.disabled = true;
            
            try {
                console.log('Updating post:', postId, {
                    title,
                    subtitle,
                    content,
                    thumbnail,
                    pinned
                });
                
                await Model.posts.update(postId, {
                    title,
                    subtitle,
                    content,
                    thumbnail,
                    pinned
                });
                
                console.log('Update successful');
                
                View.posts.hideEditForm();
                
                // If we're viewing a post, reload it to see the changes
                if (window.location.hash === `#${postId}`) {
                    View.posts.showFullPost(postId);
                } else {
                    // Otherwise just reload the posts list
                    this.loadPosts();
                }
                
                View.showError('Post updated successfully!');
            } catch (error) {
                console.error('Error updating post:', error);
                View.showError('Error updating post: ' + error.message);
            } finally {
                // Reset button state
                submitButton.textContent = originalButtonText;
                submitButton.disabled = false;
            }
        },

        // Add to Controller object
        handleDeleteComment: async function(postId, commentId) {
            try {
                const result = await Model.comments.deleteComment(postId, commentId);
                
                // If it was just an update (non-admin user deleting their own comment)
                // we can just update the comment display
                if (result && result.updated) {
                    const commentElement = document.querySelector(`.comment[data-comment-id="${commentId}"] .comment-content`);
                    if (commentElement) {
                        commentElement.innerHTML = '<em>[Comment deleted by author]</em>';
                        
                        // Also hide the delete button
                        const deleteBtn = document.querySelector(`.comment[data-comment-id="${commentId}"] .delete-comment-btn`);
                        if (deleteBtn) deleteBtn.style.display = 'none';
                    }
                } else {
                    // For admin deletions that actually remove the comment, reload comments
                    this.loadComments(postId);
                }
            } catch (error) {
                View.showError('Error deleting comment: ' + error.message);
            }
        },
        
        handleCreatePost: async function(e) {
            e.preventDefault();
            
            const title = document.getElementById('post-title').value;
            const subtitle = document.getElementById('post-subtitle').value;
            const content = document.getElementById('post-content').value;
            const thumbnail = document.getElementById('post-thumbnail').value;
            const pinned = document.getElementById('post-pinned').checked; // Get pinned status
            
            try {
                await Model.posts.create({
                    title,
                    subtitle,
                    content,
                    thumbnail,
                    pinned // Include pinned status
                });
                
                View.posts.clearPostForm();
                this.loadPosts();
                View.showError('Post created successfully!');
            } catch (error) {
                View.showError('Error creating post: ' + error.message);
            }
        },

        updateVisitorCounter: async function() {
            try {
                const visitorCount = await Model.visitors.recordVisit();
                if (visitorCount !== null) {
                    // Update the hit counter in the UI
                    const counterDigits = document.querySelectorAll('.hit-counter .counter-digits');
                    if (counterDigits.length > 0) {
                        // Convert count to string and pad with zeros
                        const countStr = visitorCount.toString().padStart(counterDigits.length, '0');
                        
                        // Update each digit
                        for (let i = 0; i < counterDigits.length; i++) {
                            counterDigits[i].textContent = countStr[i];
                        }
                    }
                }
            } catch (error) {
                console.error('Error updating visitor counter:', error);
            }
        },
        
        
        loadPosts: async function(page = null) {
            // If a specific page is requested, update current page
            if (page !== null) {
                this.currentPage = parseInt(page);
            }
            
            // If we have a hash, we're viewing a single post
            if (window.location.hash) {
                const postId = window.location.hash.substring(1);
                View.posts.showFullPost(postId);
                return;
            }
            
            // Get container reference
            const container = View.elements.musicPostsContainer;
            
            // Create a variable to store the loading timeout
            let loadingTimeout;
            
            // Special handling for browser back button navigation
            if (this.isBrowserBackNavigation) {
                // Reset the flag
                this.isBrowserBackNavigation = false;
                
                // Special handling for browser back navigation - single animation
                try {
                    const paginationData = await Model.posts.getPaginatedPosts(this.currentPage);
                    
                    // Clear container first (we already have a loading indicator)
                    container.innerHTML = '';
                    
                    // Create all post elements
                    const fragment = document.createDocumentFragment();
                    paginationData.posts.forEach(post => {
                        const postElement = View.posts.createPostElement(post.id, post);
                        fragment.appendChild(postElement);
                    });
                    
                    // Add history-back class to container first
                    container.classList.add('history-back');
                    
                    // Then add the content
                    container.appendChild(fragment);
                    
                    // Add pagination if needed
                    if (paginationData.totalPages > 1) {
                        container.appendChild(View.posts.createPaginationElement(
                            paginationData.currentPage, 
                            paginationData.totalPages
                        ));
                    }
                    
                    // Remove animation class after animation completes
                    setTimeout(() => {
                        container.classList.remove('history-back');
                    }, 800);
                    
                    return; // Skip the rest of the function
                } catch (error) {
                    // Handle error normally
                    View.showError('Error loading posts: ' + error.message);
                    // Continue to error handling below
                }
            }
            // Special handling for regular back navigation
            else if (this.isBackNavigation) {
                // Reset the flag
                this.isBackNavigation = false;
                
                // Set a timeout to show loading indicator after 1 second
                loadingTimeout = setTimeout(() => {
                    container.innerHTML = `
                        <div id="loading-indicator" style="text-align: center; margin: 40px 0;">
                            <p>Loading posts... <span class="blink">|</span></p>
                        </div>
                    `;
                }, 1000);
            } else {
                // Standard loading indicator for normal navigation after 1 second delay
                loadingTimeout = setTimeout(() => {
                    container.innerHTML = `
                        <div id="loading-indicator" style="text-align: center; margin: 40px 0;">
                            <p>Loading posts... <span class="blink">|</span></p>
                        </div>
                    `;
                }, 1000);
            }
            
            try {
                const paginationData = await Model.posts.getPaginatedPosts(this.currentPage);
                
                // Clear the loading timeout if it hasn't triggered yet
                if (loadingTimeout) {
                    clearTimeout(loadingTimeout);
                }
                
                // Handle animations based on navigation type
                if (this.isBackNavigationComplete) {
                    // Flag for the final phase of back navigation
                    this.isBackNavigationComplete = false;
                    
                    // Add animation class first
                    container.classList.add('history-back');
                    
                    // Then update content
                    View.posts.renderPaginated(paginationData);
                    
                    // Remove animation class after animation completes
                    setTimeout(() => {
                        container.classList.remove('history-back');
                    }, 800);
                } else if (this.isBackNavigation) {
                    // First phase of back navigation is complete
                    this.isBackNavigation = false;
                    this.isBackNavigationComplete = true;
                    
                    // Add history-back class for animation
                    container.classList.add('history-back');
                    
                    // Update view with pagination info
                    View.posts.renderPaginated(paginationData);
                    
                    // Remove the class after animation completes
                    setTimeout(() => {
                        container.classList.remove('history-back');
                    }, 800);
                } else {
                    // Normal update without back animation
                    View.posts.renderPaginated(paginationData);
                }
                
            } catch (error) {
                // Clear the loading timeout if it hasn't triggered yet
                if (loadingTimeout) {
                    clearTimeout(loadingTimeout);
                }
                
                View.showError('Error loading posts: ' + error.message);
                
                // Show error state
                container.innerHTML = `
                    <div class="post" style="text-align: center;">
                        <div class="post-header">
                            <h2 class="post-title">Error Loading Posts</h2>
                        </div>
                        <div class="post-content">
                            <p>There was an error loading the posts. Please try again later.</p>
                            <button id="retry-load" class="btn">Retry</button>
                        </div>
                    </div>
                `;
                
                // Add retry button functionality
                const retryButton = document.getElementById('retry-load');
                if (retryButton) {
                    retryButton.addEventListener('click', () => this.loadPosts());
                }
            }
        },

        
        handleCommentSubmit: async function(form) {
            const postId = form.getAttribute('data-post-id');
            
            if (postId === 'welcome') {
                View.showError('Cannot add comments to the default post. Create a new post as admin first.');
                return;
            }
            
            const nameInput = form.querySelector('.comment-name');
            const contentInput = form.querySelector('.comment-text');
            
            const authorName = nameInput.value.trim();
            const content = contentInput.value.trim();
            
            if (!content) {
                View.showError('Please enter a comment');
                return;
            }
            
            // Show sending state on button
            const submitButton = form.querySelector('button[type="submit"]');
            const originalButtonText = submitButton.textContent;
            submitButton.textContent = 'Posting...';
            submitButton.disabled = true;
            
            try {
                const commentRef = await Model.comments.create(postId, {
                    authorName,
                    content,
                    parentId: null,
                    level: 0
                });
                
                form.reset();
                
                // Reset the button after form reset
                submitButton.textContent = originalButtonText;
                submitButton.disabled = false;
                
                // Load comments with smooth scrolling to the new comment
                this.loadComments(postId, true, commentRef.id);
            } catch (error) {
                // Reset the button on error too
                submitButton.textContent = originalButtonText;
                submitButton.disabled = false;
                
                View.showError('Error adding comment: ' + error.message);
            }
        },
        
        handleReplySubmit: async function(form) {
            const postId = form.getAttribute('data-post-id');
            const parentId = form.getAttribute('data-parent-id');
            const ancestorsAttr = form.getAttribute('data-ancestors');
            const depth = parseInt(form.getAttribute('data-depth'));
            
            const nameInput = form.querySelector('.comment-name');
            const contentInput = form.querySelector('.comment-text');
            
            const authorName = nameInput.value.trim();
            const content = contentInput.value.trim();
            
            if (!content) {
                View.showError('Please enter a reply');
                return;
            }
            
            try {
                // Show loading state
                const submitBtn = form.querySelector('button[type="submit"]');
                const originalBtnText = submitBtn.textContent;
                submitBtn.disabled = true;
                submitBtn.textContent = 'Posting...';
                
                // Parse ancestors array
                const ancestors = ancestorsAttr ? JSON.parse(ancestorsAttr) : [];
                
                // Create the reply with updated ancestry tracking
                const replyRef = await Model.comments.create(postId, {
                    authorName,
                    content,
                    parentId,
                    ancestors,
                    depth
                });
                
                // Reset form and hide it
                form.reset();
                form.style.display = 'none';
                
                // Reset the reply button state
                const replyButton = form.closest('.comment').querySelector('.reply-button');
                if (replyButton) replyButton.classList.remove('active-reply');
        
                const mainCommentForm = document.querySelector(`.post-full[data-post-id="${postId}"] .comment-form`);
                if (mainCommentForm) {
                    mainCommentForm.style.display = 'block';
                    mainCommentForm.classList.remove('hidden');
                }
                
                // Check if we're in a thread view
                const threadBackBtn = document.querySelector('.thread-back-btn');
                if (threadBackBtn) {
                    // In thread view, reload just this thread
                    const threadComment = threadBackBtn.nextElementSibling;
                    if (threadComment && threadComment.hasAttribute('data-comment-id')) {
                        const threadCommentId = threadComment.getAttribute('data-comment-id');
                        await this.loadThread(postId, threadCommentId, replyRef.id);
                    } else {
                        // Fallback to loading all comments
                        await this.loadComments(postId, true, replyRef.id);
                    }
                } else {
                    // Normal view, reload all comments with smooth scrolling to the new reply
                    await this.loadComments(postId, true, replyRef.id);
                }
                
                // Reset button state
                submitBtn.disabled = false;
                submitBtn.textContent = originalBtnText;
            } catch (error) {
                View.showError('Error adding reply: ' + error.message);
                
                // Reset button state in case of error
                const submitBtn = form.querySelector('button[type="submit"]');
                submitBtn.disabled = false;
                submitBtn.textContent = 'Post Reply';
            }
        },

        navigateToAllPosts: function(fromElement) {
            // Prevent multiple navigations
            if (this.isNavigating) {
                // Force reset isNavigating if it's been true for too long
                if (this._navigationTimeoutId) {
                    clearTimeout(this._navigationTimeoutId);
                }
                this._navigationTimeoutId = setTimeout(() => {
                    this.isNavigating = false;
                }, 100);
                return;
            }
            
            this.isNavigating = true;
            
            // Set a safety timeout to ensure isNavigating eventually resets
            if (this._navigationTimeoutId) {
                clearTimeout(this._navigationTimeoutId);
            }
            this._navigationTimeoutId = setTimeout(() => {
                this.isNavigating = false;
            }, 2000);
            
            // Update URL
            if (window.location.hash) {
                history.pushState("", document.title, window.location.pathname + window.location.search);
            }
            
            // Fade out the post if we're on a post page
            if (fromElement) {
                fromElement.style.opacity = '0';
            }
            
            // Direct handling to avoid double-animations
            setTimeout(() => {
                const container = View.elements.musicPostsContainer;
                
                // IMPORTANT: Force remove all child elements instead of using innerHTML
                // This ensures no references are kept to old posts
                while (container.firstChild) {
                    container.removeChild(container.firstChild);
                }
                
                // Process a direct render of the posts with single animation
                Model.posts.getPaginatedPosts(this.currentPage).then(paginationData => {
                    // Ensure container is still empty before adding new content
                    while (container.firstChild) {
                        container.removeChild(container.firstChild);
                    }
                    
                    // First add all posts
                    const fragment = document.createDocumentFragment();
                    
                    // Track post IDs to prevent duplicates
                    const addedPostIds = new Set();
                    
                    paginationData.posts.forEach(post => {
                        // Skip if we've already added this post (prevent duplicates)
                        if (addedPostIds.has(post.id)) {
                            console.warn(`Skipping duplicate post: ${post.id}`);
                            return;
                        }
                        
                        // Add post ID to tracking set
                        addedPostIds.add(post.id);
                        
                        // Create and add post element
                        const postElement = View.posts.createPostElement(post.id, post);
                        fragment.appendChild(postElement);
                    });
                    
                    // Add the posts to container
                    container.appendChild(fragment);
                    
                    // Add pagination if needed
                    if (paginationData.totalPages > 1) {
                        container.appendChild(View.posts.createPaginationElement(
                            paginationData.currentPage, paginationData.totalPages
                        ));
                    }
                    
                    // Apply a SINGLE animation via the class
                    container.classList.add('history-back');
                    
                    // Remove class after animation completes
                    setTimeout(() => {
                        container.classList.remove('history-back');
                        this.isNavigating = false;
                        // Clear the safety timeout
                        if (this._navigationTimeoutId) {
                            clearTimeout(this._navigationTimeoutId);
                            this._navigationTimeoutId = null;
                        }
                    }, 800);
                }).catch(error => {
                    console.error('Error loading posts:', error);
                    // Ensure isNavigating is reset on error
                    this.isNavigating = false;
                    if (this._navigationTimeoutId) {
                        clearTimeout(this._navigationTimeoutId);
                        this._navigationTimeoutId = null;
                    }
                });
            }, 300);
        },
        
        loadComments: async function(postId, scrollToNew = false, newCommentId = null) {
            try {
                // Get the comments container
                const commentsContainer = document.getElementById(`comments-${postId}`);
                if (!commentsContainer) return;
                
                // Variable to store loading overlay and timeout
                let loadingOverlay;
                let loadingTimeout;
                
                // Create loading overlay but don't add it yet
                loadingOverlay = document.createElement('div');
                loadingOverlay.className = 'comments-loading-overlay';
                loadingOverlay.innerHTML = `<p>Loading comments... <span class="blink">|</span></p>`;
                
                // Set a timeout to show loading indicator after 1 second
                loadingTimeout = setTimeout(() => {
                    // Check if the comments container still exists
                    if (commentsContainer) {
                        commentsContainer.insertBefore(loadingOverlay, commentsContainer.firstChild);
                        // Show the loading overlay smoothly
                        setTimeout(() => loadingOverlay.classList.add('active'), 10);
                    }
                }, 1000);
        
                // Get user's IP address for checking comment ownership
                const ipResponse = await fetch('https://api.ipify.org?format=json');
                const ipData = await ipResponse.json();
                const userIp = ipData.ip;
                
                // Get main comment form and make sure it's visible
                const mainCommentForm = document.querySelector(`.post-full[data-post-id="${postId}"] .comment-form`);
                if (mainCommentForm) {
                    mainCommentForm.style.display = 'block';
                }
                
                // Get ALL comments for the post, not just top-level
                const commentsSnapshot = await Model.db.collection('music-posts')
                    .doc(postId)
                    .collection('comments')
                    .orderBy('timestamp', 'desc')
                    .get();
                        
                const allComments = commentsSnapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                }));
                
                // Clear loading timeout if it hasn't triggered yet
                if (loadingTimeout) {
                    clearTimeout(loadingTimeout);
                }
                
                // Get top-level comments
                const topLevelComments = allComments.filter(comment => comment.parentId === null);
                
                // Organize replies by parent ID
                const repliesByParent = {};
                allComments.forEach(comment => {
                    if (comment.parentId) {
                        if (!repliesByParent[comment.parentId]) {
                            repliesByParent[comment.parentId] = [];
                        }
                        repliesByParent[comment.parentId].push(comment);
                    }
                });
                
                // Hide and remove loading overlay if it was added
                if (loadingOverlay && loadingOverlay.parentNode) {
                    loadingOverlay.classList.remove('active');
                    
                    // Wait for loading overlay to hide before removing it
                    setTimeout(() => {
                        if (loadingOverlay.parentNode) {
                            loadingOverlay.parentNode.removeChild(loadingOverlay);
                        }
                    }, 300);
                }
                
                // Render top-level comments
                View.comments.renderComments(postId, topLevelComments, userIp, false, newCommentId);
                
                // For each top-level comment, render its replies
                topLevelComments.forEach(comment => {
                    const commentElement = document.querySelector(`.comment[data-comment-id="${comment.id}"]`);
                    if (commentElement) {
                        View.comments.renderNestedReplies(postId, comment.id, repliesByParent, commentElement, userIp, 0, newCommentId);
                    }
                });
                
                // If we added a new comment, scroll to it
                if (scrollToNew && newCommentId) {
                    setTimeout(() => {
                        const newComment = document.querySelector(`.comment[data-comment-id="${newCommentId}"]`);
                        if (newComment) {
                            newComment.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }
                    }, 300);
                }
                    
            } catch (error) {
                console.error('Error loading comments:', error);
                // Show error message
                const commentsContainer = document.getElementById(`comments-${postId}`);
                if (commentsContainer) {
                    commentsContainer.innerHTML = `
                        <div class="error-message">
                            <p>Error loading comments. Please try again later.</p>
                        </div>
                    `;
                }
            }
        },
        togglePinned: async function(postId) {
            try {
                const user = Model.auth.getCurrentUser();
                if (!user) throw new Error('Not authenticated');
                
                // Get current post data
                const post = await this.getPost(postId);
                
                // Toggle pinned status
                await Model.db.collection('music-posts')
                    .doc(postId)
                    .update({
                        pinned: !post.pinned
                    });
                    
                return !post.pinned; // Return the new pinned status
            } catch (error) {
                throw error;
            }
        },
         
        loadThread: async function(postId, commentId) {
            try {
                // Show loading indicator
                const commentsContainer = document.getElementById(`comments-${postId}`);
                if (commentsContainer) {
                    commentsContainer.innerHTML = `
                        <div class="comment-loading">
                            <p>Loading thread... <span class="blink">|</span></p>
                        </div>
                    `;
                }
        
                // Get user's IP for like button status
                const ipResponse = await fetch('https://api.ipify.org?format=json');
                const ipData = await ipResponse.json();
                const userIp = ipData.ip;
                
                // Hide main comment form when viewing a thread
                const mainCommentForm = document.querySelector(`.post-full[data-post-id="${postId}"] .comment-form`);
                if (mainCommentForm) {
                    mainCommentForm.style.display = 'none';
                }
                
                // Get the main comment
                const commentDoc = await Model.db.collection('music-posts')
                    .doc(postId)
                    .collection('comments')
                    .doc(commentId)
                    .get();
                    
                if (!commentDoc.exists) {
                    throw new Error('Comment not found');
                }
                
                const mainComment = {
                    id: commentDoc.id,
                    ...commentDoc.data()
                };
                
                // Get ALL replies in the thread
                const repliesSnapshot = await Model.db.collection('music-posts')
                    .doc(postId)
                    .collection('comments')
                    .where('ancestors', 'array-contains', commentId)
                    .orderBy('timestamp', 'asc')
                    .get();
                    
                const replies = repliesSnapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                }));
                
                // Organize replies by parent ID
                const repliesByParent = {};
                replies.forEach(reply => {
                    if (!repliesByParent[reply.parentId]) {
                        repliesByParent[reply.parentId] = [];
                    }
                    repliesByParent[reply.parentId].push(reply);
                });
                
                // Render the thread
                commentsContainer.innerHTML = '';
                
                // Add back button
                const backButton = document.createElement('button');
                backButton.className = 'btn back-btn thread-back-btn';
                backButton.textContent = 'Back to all comments';
                backButton.addEventListener('click', () => {
                    // Exit thread view and show all comments
                    this.loadComments(postId);
                });
                commentsContainer.appendChild(backButton);
                
                // Add the main comment
                const mainCommentElement = View.comments.createCommentElement(
                    postId, 
                    mainComment.id, 
                    mainComment, 
                    false, 
                    userIp
                );
                commentsContainer.appendChild(mainCommentElement);
                
                // Render direct replies to the main comment
                View.comments.renderNestedReplies(postId, mainComment.id, repliesByParent, mainCommentElement, userIp, 0);
            } catch (error) {
                console.error('Error loading thread:', error);
                // Show error message
                const commentsContainer = document.getElementById(`comments-${postId}`);
                if (commentsContainer) {
                    commentsContainer.innerHTML = `
                        <div class="error-message">
                            <p>Error loading thread. <button id="back-to-comments" class="btn">Back to comments</button></p>
                        </div>
                    `;
                    
                    // Add event listener to back button
                    const backButton = document.getElementById('back-to-comments');
                    if (backButton) {
                        backButton.addEventListener('click', () => {
                            this.loadComments(postId);
                        });
                    }
                }
            }
        }      
    };
    
    Controller.init();
});
function resetMarqueeAnimation() {
    // Get the original element
    const originalMarquee = document.querySelector('.marquee');
    if (!originalMarquee) return;
    
    // Get the parent element
    const parent = originalMarquee.parentNode;
    
    // Create a completely new marquee element
    const newMarquee = document.createElement('div');
    newMarquee.className = 'marquee';
    
    // Create the inner content element
    const newContent = document.createElement('div');
    newContent.className = 'marquee-content';
    
    // Set the base content
    const baseContent = "WELCOME TO MY MUSIC PAGE • DISCOVER SONGS I LIKE • SHARE YOUR THOUGHTS";
    
    // Check if animations should be enabled
    const animationsDisabled = document.body.classList.contains('animations-disabled');
    
    if (!animationsDisabled) {
        // Triple content for continuous scrolling
        newContent.textContent = baseContent + ' • ' + baseContent + ' • ' + baseContent;
        // Don't set any inline styles - let CSS handle it completely
    } else {
        // Single content for disabled state
        newContent.textContent = baseContent;
    }
    
    // Assemble the new element
    newMarquee.appendChild(newContent);
    
    // Replace the old element with the new one
    parent.replaceChild(newMarquee, originalMarquee);
}
