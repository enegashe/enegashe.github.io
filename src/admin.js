/**
 * Music Blog Admin Panel
 * 
 * This script implements the admin functionality for the Music Blog using MVC design pattern:
 * - Model: Handles data interactions with Firebase (auth, Firestore)
 * - View: Manages the DOM updates and UI rendering
 * - Controller: Coordinates between Model and View, handles user interactions
 */
document.addEventListener('DOMContentLoaded', function() {

    /**
     * MODEL
     * Handles all Firebase data operations and business logic
     */
    const Model = {
        // Firebase configuration loaded from external file
        firebaseConfig: window.firebaseConfig || {},
        
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
        
        // Authentication methods using our custom wrapper
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
                        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
                        authorId: user.uid,
                        authorEmail: user.email
                    };
                    
                    return await Model.db.collection('music-posts').add(post);
                } catch (error) {
                    throw error;
                }
            },
            
            getAllPosts: async function() {
                try {
                    const snapshot = await Model.db.collection('music-posts')
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
            
            deletePost: async function(postId) {
                try {
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
            
            updatePost: async function(postId, postData) {
                try {
                    const user = Model.auth.getCurrentUser();
                    if (!user) throw new Error('Not authenticated');
                    
                    return await Model.db.collection('music-posts')
                        .doc(postId)
                        .update({
                            title: postData.title,
                            subtitle: postData.subtitle,
                            content: postData.content,
                            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                        });
                } catch (error) {
                    throw error;
                }
            }
        },
        
        // Comments methods
        comments: {
            getAllComments: async function() {
                try {
                    // Get all posts first
                    const postsSnapshot = await Model.db.collection('music-posts').get();
                    const allComments = [];
                    
                    // For each post, get its comments
                    for (const postDoc of postsSnapshot.docs) {
                        const commentsSnapshot = await postDoc.ref.collection('comments')
                            .orderBy('timestamp', 'desc')
                            .limit(50) // Limit to recent comments
                            .get();
                        
                        const postComments = commentsSnapshot.docs.map(doc => ({
                            id: doc.id,
                            postId: postDoc.id,
                            postTitle: postDoc.data().title,
                            ...doc.data()
                        }));
                        
                        allComments.push(...postComments);
                    }
                    
                    // Sort all comments by timestamp (most recent first)
                    return allComments.sort((a, b) => {
                        const aTime = a.timestamp ? a.timestamp.toDate().getTime() : 0;
                        const bTime = b.timestamp ? b.timestamp.toDate().getTime() : 0;
                        return bTime - aTime;
                    });
                } catch (error) {
                    throw error;
                }
            },
            
            deleteComment: async function(postId, commentId) {
                try {
                    // First, get all replies to this comment
                    const repliesSnapshot = await Model.db.collection('music-posts')
                        .doc(postId)
                        .collection('comments')
                        .where('parentId', '==', commentId)
                        .get();
                    
                    // Delete all replies and the comment itself
                    const batch = Model.db.batch();
                    
                    // Delete all replies
                    repliesSnapshot.docs.forEach(doc => {
                        batch.delete(doc.ref);
                    });
                    
                    // Delete the comment
                    batch.delete(Model.db.collection('music-posts')
                        .doc(postId)
                        .collection('comments')
                        .doc(commentId));
                    
                    // Commit the batch
                    return await batch.commit();
                } catch (error) {
                    throw error;
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
            // Views
            loginView: document.getElementById('login-view'),
            adminDashboard: document.getElementById('admin-dashboard'),
            
            // Forms
            loginForm: document.getElementById('login-form'),
            postForm: document.getElementById('post-form'),
            
            // Status elements
            userStatus: document.getElementById('user-status'),
            errorMessage: document.getElementById('error-message'),
            successMessage: document.getElementById('success-message'),
            
            // Content areas
            postsList: document.getElementById('posts-list'),
            commentsList: document.getElementById('comments-list'),
            previewContainer: document.getElementById('preview-container'),
            previewContent: document.getElementById('preview-content'),
            
            // Buttons
            logoutBtn: document.getElementById('logout-btn'),
            tabPosts: document.getElementById('tab-posts'),
            tabComments: document.getElementById('tab-comments'),
            postsTab: document.getElementById('posts-tab'),
            commentsTab: document.getElementById('comments-tab'),
            
            // Form inputs
            email: document.getElementById('email'),
            password: document.getElementById('password'),
            postTitle: document.getElementById('post-title'),
            postSubtitle: document.getElementById('post-subtitle'),
            postContent: document.getElementById('post-content')
        },
        
        // View initialization
        init: function() {
            // Initialize SimpleMDE for markdown editing
            this.initMarkdownEditor();
        },
        
        // Initialize SimpleMDE
        initMarkdownEditor: function() {
            this.simpleMDE = new SimpleMDE({
                element: View.elements.postContent,
                spellChecker: false,
                status: false,
                toolbar: [
                    'bold', 'italic', 'heading', '|',
                    'unordered-list', 'ordered-list', '|',
                    'link', 'image', '|',
                    'preview', 'guide'
                ],
                previewRender: function(plainText) {
                    // Custom preview rendering with YouTube support
                    let html = marked.parse(plainText);
                    
                    // Process YouTube embeds - look for ![video](youtube-url) pattern
                    const videoRegex = /!\[video\]\((https:\/\/(?:www\.)?youtu(?:be\.com\/watch\?v=|\.be\/)([a-zA-Z0-9_-]+)(?:&\S*)?)\)/g;
                    html = html.replace(videoRegex, (match, url, videoId) => {
                        return `<iframe width="100%" height="315" src="https://www.youtube.com/embed/${videoId}" frameborder="0" allowfullscreen></iframe>`;
                    });
                    
                    return html;
                }
            });
        },
        
        // Authentication UI updates
        auth: {
            updateUI: function(user) {
                if (user) {
                    // User is signed in
                    View.elements.loginView.style.display = 'none';
                    View.elements.adminDashboard.style.display = 'block';
                    View.elements.userStatus.textContent = `Logged in as: ${user.email}`;
                } else {
                    // User is signed out
                    View.elements.loginView.style.display = 'block';
                    View.elements.adminDashboard.style.display = 'none';
                    View.elements.userStatus.textContent = 'Not logged in';
                }
            },
            
            showError: function(message) {
                View.elements.errorMessage.textContent = message;
                View.elements.errorMessage.style.display = 'block';
                
                // Auto-hide after 5 seconds
                setTimeout(() => {
                    View.elements.errorMessage.style.display = 'none';
                }, 5000);
            },
            
            showSuccess: function(message) {
                View.elements.successMessage.textContent = message;
                View.elements.successMessage.style.display = 'block';
                
                // Auto-hide after 5 seconds
                setTimeout(() => {
                    View.elements.successMessage.style.display = 'none';
                }, 5000);
            },
            
            clearLoginForm: function() {
                View.elements.loginForm.reset();
            }
        },
        
        // Post management
        posts: {
            renderList: function(posts) {
                const container = View.elements.postsList;
                
                if (posts.length === 0) {
                    container.innerHTML = '<p>No posts found. Create your first post!</p>';
                    return;
                }
                
                container.innerHTML = '';
                
                posts.forEach(post => {
                    const postElement = View.posts.createPostElement(post);
                    container.appendChild(postElement);
                });
            },
            
            createPostElement: function(post) {
                const postDiv = document.createElement('div');
                postDiv.className = 'post-item';
                postDiv.setAttribute('data-post-id', post.id);
                
                // Format the timestamp
                let dateDisplay = 'Draft';
                if (post.timestamp) {
                    const date = post.timestamp.toDate();
                    dateDisplay = date.toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric'
                    });
                }
                
                postDiv.innerHTML = `
                    <div class="post-item-title">${post.title}</div>
                    <div class="post-item-subtitle">${post.subtitle}</div>
                    <div class="post-item-date">${dateDisplay}</div>
                    <div class="post-item-actions">
                        <button class="btn edit-post-btn" data-post-id="${post.id}">Edit</button>
                        <button class="btn delete-post-btn" data-post-id="${post.id}">Delete</button>
                        <a href="music.html" class="btn" target="_blank">View Live</a>
                    </div>
                `;
                
                return postDiv;
            },
            
            clearPostForm: function() {
                View.elements.postForm.reset();
                View.simpleMDE.value('');
            },
            
            fillPostForm: function(post) {
                View.elements.postTitle.value = post.title;
                View.elements.postSubtitle.value = post.subtitle;
                View.simpleMDE.value(post.content);
                
                // Update the button to indicate we're editing
                const submitButton = View.elements.postForm.querySelector('button[type="submit"]');
                submitButton.textContent = 'Update Post';
                submitButton.setAttribute('data-mode', 'edit');
                submitButton.setAttribute('data-post-id', post.id);
                
                // Scroll to the form
                View.elements.postForm.scrollIntoView({ behavior: 'smooth' });
            },
            
            resetPostForm: function() {
                // Reset to "Create" mode
                const submitButton = View.elements.postForm.querySelector('button[type="submit"]');
                submitButton.textContent = 'Publish Post';
                submitButton.removeAttribute('data-mode');
                submitButton.removeAttribute('data-post-id');
                
                // Clear the form
                View.posts.clearPostForm();
            }
        },
        
        // Comment management
        comments: {
            renderList: function(postId, comments) {
                const container = document.getElementById(`comments-${postId}`);
                
                if (!container) return;
                
                if (comments.length === 0) {
                    container.innerHTML = '<p>No comments yet. Be the first to comment!</p>';
                    return;
                }
                
                container.innerHTML = '';
                
                comments.forEach(comment => {
                    const commentElement = View.comments.createCommentElement(postId, comment.id, comment);
                    container.appendChild(commentElement);
                });
            },
            
            renderReplies: function(postId, commentId, replies, parentElement) {
                if (replies.length === 0) return;
                
                const repliesDiv = document.createElement('div');
                repliesDiv.className = 'replies';
                
                // Group replies by level
                const firstLevelReplies = replies.filter(reply => reply.level === 1);
                const secondLevelReplies = replies.filter(reply => reply.level === 2);
                
                // Render first level replies
                firstLevelReplies.forEach(reply => {
                    const replyElement = View.comments.createCommentElement(postId, reply.id, reply, true);
                    repliesDiv.appendChild(replyElement);
                    
                    // Create container for potential second-level replies to this reply
                    const secondLevelContainer = document.createElement('div');
                    secondLevelContainer.className = 'second-level-replies';
                    secondLevelContainer.setAttribute('data-parent-id', reply.id);
                    replyElement.appendChild(secondLevelContainer);
                    
                    // Add any second level replies that belong to this first level reply
                    const childReplies = secondLevelReplies.filter(r => r.parentId === reply.id);
                    childReplies.forEach(childReply => {
                        const childElement = View.comments.createCommentElement(postId, childReply.id, childReply, true);
                        secondLevelContainer.appendChild(childElement);
                    });
                });
                
                parentElement.appendChild(repliesDiv);
            },
            
            createCommentElement: function(postId, commentId, comment, isReply = false) {
                const commentDiv = document.createElement('div');
                commentDiv.className = 'comment';
                commentDiv.setAttribute('data-comment-id', commentId);
                
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
                
                // Use 'Anonymous' if no name provided
                const authorName = comment.authorName ? comment.authorName : 'Anonymous';
                
                // Convert comment content from markdown to HTML
                const htmlContent = marked.parse(comment.content);
                
                commentDiv.innerHTML = `
                    <div class="comment-header">
                        <span class="comment-author">${authorName}</span>
                        <span class="comment-date">${dateDisplay}</span>
                    </div>
                    <div class="comment-content">
                        ${htmlContent}
                    </div>
                `;
                
                // Only add reply button if not a second-level reply (to limit nesting depth)
                if (!isReply || comment.level !== 2) {
                    const replyButton = document.createElement('button');
                    replyButton.className = 'btn reply-button';
                    replyButton.textContent = 'Reply';
                    commentDiv.appendChild(replyButton);
                    
                    // Create reply form (hidden by default)
                    const replyForm = document.createElement('form');
                    replyForm.className = 'reply-form';
                    replyForm.style.display = 'none';
                    replyForm.innerHTML = `
                        <input type="text" placeholder="Your Name (optional)" class="comment-name">
                        <textarea placeholder="Write your reply here... Markdown supported." class="comment-text" required></textarea>
                        <button type="submit" class="btn">Post Reply</button>
                    `;
                    
                    // Set data attributes for the reply form
                    replyForm.setAttribute('data-post-id', postId);
                    replyForm.setAttribute('data-parent-id', commentId);
                    replyForm.setAttribute('data-level', isReply ? '2' : '1');
                    
                    commentDiv.appendChild(replyForm);
                }
                
                return commentDiv;
            }
        },
        
        // Tab management
        tabs: {
            switchToTab: function(tabName) {
                // Update tab buttons
                View.elements.tabPosts.classList.toggle('active', tabName === 'posts');
                View.elements.tabComments.classList.toggle('active', tabName === 'comments');
                
                // Update tab content
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
        // Initialize the application
        init: function() {
            // Initialize Firebase
            const firebaseData = Model.init();
            
            // Generate stars background
            View.generateStars();
            
            // Set up event listeners
            this.setupEventListeners();
            
            // Set up auth state listener
            Model.auth.onAuthStateChanged(user => {
                View.auth.updateUI(user);
                
                if (user) {
                    // Load data when authenticated
                    this.loadPosts();
                    this.loadComments();
                }
            });
        },
        
        // Set up all event listeners
        setupEventListeners: function() {
            // Login form
            View.elements.loginForm.addEventListener('submit', this.handleLogin.bind(this));
            
            // Logout button
            View.elements.logoutBtn.addEventListener('click', this.handleLogout.bind(this));
            
            // Post form
            View.elements.postForm.addEventListener('submit', this.handlePostSubmit.bind(this));
            
            // Tab switching
            View.elements.tabPosts.addEventListener('click', () => View.tabs.switchToTab('posts'));
            View.elements.tabComments.addEventListener('click', () => View.tabs.switchToTab('comments'));
            
            // Post and comment actions (using event delegation)
            View.elements.postsList.addEventListener('click', this.handlePostAction.bind(this));
            View.elements.commentsList.addEventListener('click', this.handleCommentAction.bind(this));
        },
        
        // Authentication handlers
        handleLogin: async function(e) {
            e.preventDefault();
            
            const email = View.elements.email.value;
            const password = View.elements.password.value;
            
            try {
                await Model.auth.login(email, password);
                View.auth.clearLoginForm();
            } catch (error) {
                View.auth.showError('Login failed: ' + error.message);
            }
        },
        
        handleLogout: async function() {
            try {
                await Model.auth.logout();
            } catch (error) {
                View.auth.showError('Error signing out: ' + error.message);
            }
        },
        
        // Post handlers
        handlePostSubmit: async function(e) {
            e.preventDefault();
            
            const title = View.elements.postTitle.value;
            const subtitle = View.elements.postSubtitle.value;
            const content = View.simpleMDE.value();
            
            const submitButton = e.target.querySelector('button[type="submit"]');
            const isEditMode = submitButton.getAttribute('data-mode') === 'edit';
            
            try {
                if (isEditMode) {
                    // Update existing post
                    const postId = submitButton.getAttribute('data-post-id');
                    await Model.posts.updatePost(postId, { title, subtitle, content });
                    View.auth.showSuccess('Post updated successfully!');
                } else {
                    // Create new post
                    await Model.posts.create({ title, subtitle, content });
                    View.auth.showSuccess('Post created successfully!');
                }
                
                // Reset the form and reload posts
                View.posts.resetPostForm();
                this.loadPosts();
            } catch (error) {
                View.auth.showError('Error saving post: ' + error.message);
            }
        },
        
        loadPosts: async function() {
            try {
                const posts = await Model.posts.getAllPosts();
                View.posts.renderList(posts);
            } catch (error) {
                View.auth.showError('Error loading posts: ' + error.message);
                View.posts.renderList([]);
            }
        },
        
        handlePostAction: async function(e) {
            // Handle edit post button
            if (e.target.classList.contains('edit-post-btn')) {
                const postId = e.target.getAttribute('data-post-id');
                try {
                    const post = await Model.posts.getPost(postId);
                    View.posts.fillPostForm(post);
                } catch (error) {
                    View.auth.showError('Error loading post: ' + error.message);
                }
            }
            
            // Handle delete post button
            if (e.target.classList.contains('delete-post-btn')) {
                const postId = e.target.getAttribute('data-post-id');
                if (confirm('Are you sure you want to delete this post? This action cannot be undone.')) {
                    try {
                        await Model.posts.deletePost(postId);
                        View.auth.showSuccess('Post deleted successfully!');
                        this.loadPosts();
                    } catch (error) {
                        View.auth.showError('Error deleting post: ' + error.message);
                    }
                }
            }
        },
        
        // Comment handlers
        loadComments: async function() {
            try {
                const comments = await Model.comments.getAllComments();
                // Since comments are across posts, render them per post
                comments.forEach(comment => {
                    View.comments.renderList(comment.postId, [comment]);
                });
            } catch (error) {
                View.auth.showError('Error loading comments: ' + error.message);
            }
        },
        
        handleCommentAction: async function(e) {
            // Handle delete comment button
            if (e.target.classList.contains('delete-comment-btn')) {
                const commentId = e.target.getAttribute('data-comment-id');
                const postId = e.target.getAttribute('data-post-id');
                
                if (confirm('Are you sure you want to delete this comment? This action cannot be undone.')) {
                    try {
                        await Model.comments.deleteComment(postId, commentId);
                        View.auth.showSuccess('Comment deleted successfully!');
                        this.loadComments();
                    } catch (error) {
                        View.auth.showError('Error deleting comment: ' + error.message);
                    }
                }
            }
        },
        
        // Comment form handlers
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
            
            try {
                await Model.comments.create(postId, {
                    authorName,
                    content,
                    parentId: null,
                    level: 0
                });
                
                form.reset();
                this.loadComments(postId);
            } catch (error) {
                View.showError('Error adding comment: ' + error.message);
            }
        },
        
        handleReplySubmit: async function(form) {
            const postId = form.getAttribute('data-post-id');
            const parentId = form.getAttribute('data-parent-id');
            const level = parseInt(form.getAttribute('data-level'));
            
            const nameInput = form.querySelector('.comment-name');
            const contentInput = form.querySelector('.comment-text');
            
            const authorName = nameInput.value.trim();
            const content = contentInput.value.trim();
            
            if (!content) {
                View.showError('Please enter a reply');
                return;
            }
            
            try {
                await Model.comments.create(postId, {
                    authorName,
                    content,
                    parentId,
                    level
                });
                
                form.reset();
                form.style.display = 'none';
                this.loadComments(postId);
            } catch (error) {
                View.showError('Error adding reply: ' + error.message);
            }
        }
    };
    
    // Start the application
    Controller.init();
});
