-- ============================================================================
-- STECHAD Platform - Complete SQLite3 Database Schema
-- ============================================================================
-- This script creates all tables, indexes, triggers
-- for the STECHAD job matching and project management platform.
-- 
-- Entities: Users, Engineers, Project Managers, Admin, Jobs, 
--           Applications, Projects, Interviews, Settings, Chats, Messages, Notifications
-- ============================================================================

-- Enable foreign key constraints (CRITICAL for SQLite)
PRAGMA foreign_keys = ON;
.headers on
.mode column

-- ============================================================================
-- 1. USERS TABLE (Authentication Base)
-- ============================================================================
CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4)))),
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password TEXT NOT NULL,
    role TEXT CHECK(role IN ('super_admin', 'admin', 'project_manager', 'engineer', 'staff')) NOT NULL,
    full_name TEXT,
    phone_number TEXT,
    is_verified INTEGER DEFAULT 0,
    avatar_object_name TEXT,
    country TEXT,
    city TEXT,
    location_sharing_enabled INTEGER NOT NULL DEFAULT 0,
    location_permission_status TEXT NOT NULL DEFAULT 'not_asked' CHECK(location_permission_status IN ('not_asked', 'granted', 'denied', 'unavailable')),
    browser_latitude REAL,
    browser_longitude REAL,
    browser_location_accuracy REAL,
    browser_location_updated_at DATETIME,
    browser_location_address TEXT,
    browser_location_city TEXT,
    browser_location_state TEXT,
    browser_location_country TEXT,
    browser_location_country_code TEXT,
    last_login DATETIME,
    reset_password_token TEXT,
    reset_password_expires DATETIME,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);
CREATE UNIQUE INDEX users_single_super_admin ON users(role) WHERE role = 'super_admin';


-- ============================================================================
-- 2. ENGINEERS TABLE (Engineer-specific data)
-- ============================================================================
CREATE TABLE IF NOT EXISTS engineers (
    engineer_id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)))) NOT NULL,
    user_id TEXT NOT NULL UNIQUE,
    
    -- Personal Information
    date_of_birth TEXT, -- Format: MM-DD
    open_to_nearby_cities TEXT CHECK(open_to_nearby_cities IN ('yes', 'no')),
    
    -- Language & Eligibility
    languages TEXT DEFAULT '[]', -- JSON array: ["English", "French"]
    language_proficiency TEXT CHECK(language_proficiency IN ('Basic', 'Conversational', 'Fluent', 'Native')),
    has_drivers_license TEXT CHECK(has_drivers_license IN ('yes', 'no')),
    has_car TEXT CHECK(has_car IN ('yes', 'no')),
    is_native TEXT CHECK(is_native IN ('yes', 'no')),
    work_authorized TEXT CHECK(work_authorized IN ('yes', 'no')),
    
    -- Professional Information
    specialization TEXT DEFAULT '[]', -- JSON array: ["Network Administration", "Cloud Computing"]
    skill_level TEXT CHECK(skill_level IN ('Beginner', 'Intermediate', 'Advanced', 'Expert')),
    years_of_experience REAL,
    certifications TEXT DEFAULT '[]', -- JSON array: ["CompTIA A+", "AWS Certified"]
    project_types TEXT DEFAULT '[]', -- JSON array: ["Full-time", "Contract", "Dispatch"]
    
    -- Additional Information
    open_to_training TEXT CHECK(open_to_training IN ('yes', 'no')),
    is_freelancer TEXT CHECK(is_freelancer IN ('yes', 'no')),
    follows_linkedin TEXT CHECK(follows_linkedin IN ('yes', 'no')),
    referee_info TEXT, -- Format: "Name, email@example.com"
    newsletter TEXT CHECK(newsletter IN ('yes', 'no')),
    special_preferences TEXT,
    cv_file_name TEXT,
    
    -- Status & Metadata
    is_vetted INTEGER DEFAULT 0 CHECK(is_vetted IN (0, 1)),
    availability TEXT DEFAULT 'Available' CHECK(availability IN ('Available', 'Busy', 'Unavailable')),
    status TEXT DEFAULT 'Active' CHECK(status IN ('Active', 'Inactive', 'Suspended')),

    is_onboarded INTEGER DEFAULT 1 CHECK(is_onboarded IN (0, 1)),
    onboarded_at TIMESTAMP,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE INDEX idx_engineers_user_id ON engineers(user_id);
CREATE INDEX idx_engineers_is_vetted ON engineers(is_vetted);
CREATE INDEX idx_engineers_availability ON engineers(availability);
CREATE INDEX idx_engineers_status ON engineers(status);

-- ============================================================================
-- 3. PROJECT MANAGERS TABLE (PM-specific data)
-- ============================================================================
CREATE TABLE IF NOT EXISTS project_managers (
    project_managers_id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4)))),
    user_id TEXT NOT NULL UNIQUE,
    company TEXT NOT NULL,
    bio TEXT,
    status TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
    total_projects INTEGER DEFAULT 0,
    total_hires INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE INDEX idx_project_managers_user_id ON project_managers(user_id);
CREATE INDEX idx_project_managers_status ON project_managers(status);

-- ============================================================================
-- 4. ADMIN TABLE (Admin-specific data)
-- ============================================================================
CREATE TABLE IF NOT EXISTS admins (
    admin_id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4)))),
    user_id INTEGER NOT NULL REFERENCES users (user_id) ON DELETE NO ACTION ON UPDATE CASCADE,
    permissions TEXT,
    is_super_admin INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL
);

-- ============================================================================
-- 5. JOBS TABLE (Job postings created by PMs)
-- ============================================================================
CREATE TABLE IF NOT EXISTS jobs (
    jobs_id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4)))),
    user_id TEXT NOT NULL, -- PM that created the job
    
    -- Basic Information
    title TEXT NOT NULL,
    company TEXT NOT NULL,
    location TEXT NOT NULL,
    description TEXT NOT NULL,
    
    -- Job Details
    job_type TEXT CHECK(job_type IN ('full-time', 'part-time', 'contract', 'internship')),
    employment_type TEXT CHECK(employment_type IN ('full-time', 'contract', 'part-time')),
    salary TEXT,
    duration TEXT, -- "3 months", "6 months", etc.
    openings INTEGER DEFAULT 1,
    experience_level TEXT, -- "Junior", "Mid level", "Senior"
    
    -- Requirements & Skills
    skills_required TEXT DEFAULT '[]', -- JSON array: ["React", "TypeScript", "Node.js"]
    responsibilities TEXT DEFAULT '[]', -- JSON array
    requirements TEXT DEFAULT '[]', -- JSON array
    
    -- Configuration
    remote INTEGER DEFAULT 0 CHECK(remote IN (0, 1)),
    status TEXT DEFAULT 'active' CHECK(status IN ('active', 'closed', 'draft')),
    
    -- Metadata
    deadline DATETIME,
    applications_count INTEGER DEFAULT 0,
    posted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE INDEX idx_jobs_pm_id ON jobs(user_id);
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_posted_at ON jobs(posted_at DESC);
CREATE INDEX idx_jobs_location ON jobs(location);

-- ============================================================================
-- 6. APPLICATIONS TABLE (Engineers applying to jobs)
-- ============================================================================
CREATE TABLE IF NOT EXISTS applications (
    applications_id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4)))),
    job_id TEXT NOT NULL,
    engineer_id TEXT NOT NULL,
    job_title TEXT NOT NULL,
    engineer_name TEXT,
    
    -- Application Details
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'reviewed', 'accepted', 'rejected')),
    experience TEXT,
    skills TEXT DEFAULT '[]', -- JSON array
    
    -- Metadata
    reviewed_at DATETIME,
    reviewed_by INTEGER REFERENCES users (user_id) ON DELETE SET NULL ON UPDATE CASCADE,
    feedback TEXT,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (job_id) REFERENCES jobs(jobs_id) ON DELETE NO ACTION ON UPDATE CASCADE,
    FOREIGN KEY (engineer_id) REFERENCES engineers(engineer_id) ON DELETE CASCADE,
    UNIQUE(job_id, engineer_id)
);

CREATE INDEX idx_applications_job_id ON applications(job_id);
CREATE INDEX idx_applications_engineer_id ON applications(engineer_id);
CREATE INDEX idx_applications_status ON applications(status);
CREATE INDEX idx_applications_applied_at ON applications(applied_at DESC);

-- ============================================================================
-- 7. PROJECTS TABLE (PM projects with tasks and team)
-- ============================================================================
CREATE TABLE IF NOT EXISTS projects (
    projects_id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4)))),
    project_managers_id TEXT NOT NULL,
    
    -- Project Information
    title TEXT NOT NULL,
    description TEXT,
    job_id INTEGER REFERENCES jobs (jobs_id) ON DELETE SET NULL ON UPDATE CASCADE,
    engineer_id INTEGER NOT NULL REFERENCES users (user_id) ON DELETE NO ACTION ON UPDATE CASCADE,
    client_name TEXT,
    status TEXT DEFAULT 'Planning' CHECK(status IN ('Planning', 'In Progress', 'Completed', 'On Hold')),
    priority TEXT DEFAULT 'Medium' CHECK(priority IN ('High', 'Medium', 'Low', 'Critical')),
    progress INTEGER DEFAULT 0 CHECK(progress >= 0 AND progress <= 100),
    
    -- Team & Tasks
    team TEXT DEFAULT '[]', -- JSON array: ["John Doe", "Jane Smith"]
    tasks TEXT DEFAULT '[]', -- JSON array of objects: [{"id": 1, "title": "...", "status": "...", "assignee": "..."}]
    
    -- Timeline
    start_date DATETIME,
    deadline DATETIME, -- ISO date: "2024-12-31"
    feedback TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (project_managers_id) REFERENCES project_managers(project_managers_id) ON DELETE CASCADE
);

CREATE INDEX idx_projects_project_managers_id ON projects(project_managers_id);
CREATE INDEX idx_projects_job ON projects(job_id);
CREATE INDEX idx_projects_engr ON projects(engineer_id);
CREATE INDEX idx_projects_status ON projects(status);
CREATE INDEX idx_projects_priority ON projects(priority);
CREATE INDEX idx_projects_deadline ON projects(deadline);

-- ============================================================================
-- 8. INTERVIEWS TABLE (Interview scheduling)
-- ============================================================================
CREATE TABLE IF NOT EXISTS interviews (
    interviews_id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4)))),
    
    -- Candidate Information
    candidate_id TEXT NOT NULL,
    candidate_name TEXT NOT NULL,
    candidate_email TEXT NOT NULL,
    
    -- Interviewer Information
    interviewer_id TEXT NOT NULL,
    interviewer_email TEXT NOT NULL,
    
    -- Job Information
    job_id TEXT NOT NULL,
    job_title TEXT NOT NULL,
    
    -- Interview Details
    date_time TEXT NOT NULL, -- ISO 8601: "2024-01-15T10:00:00Z"
    duration INTEGER DEFAULT 60, -- minutes
    phone_number TEXT,
    status TEXT DEFAULT 'scheduled' CHECK(status IN ('scheduled', 'completed', 'cancelled', 'rescheduled')),
    
    -- Links & Notes
    zoom_link TEXT,
    calendar_event_id TEXT,
    notes TEXT,
    
    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (candidate_id) REFERENCES engineers(engineer_id) ON DELETE CASCADE,
    FOREIGN KEY (interviewer_id) REFERENCES project_managers(project_managers_id) ON DELETE CASCADE,
    FOREIGN KEY (job_id) REFERENCES jobs(jobs_id) ON DELETE CASCADE
);

CREATE INDEX idx_interviews_candidate_id ON interviews(candidate_id);
CREATE INDEX idx_interviews_interviewer_id ON interviews(interviewer_id);
CREATE INDEX idx_interviews_job_id ON interviews(job_id);
CREATE INDEX idx_interviews_status ON interviews(status);
CREATE INDEX idx_interviews_date_time ON interviews(date_time);

-- ============================================================================
-- 9. CHATS TABLE (Chat conversations)
-- ============================================================================
CREATE TABLE IF NOT EXISTS chats (
    chats_id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4)))),
    
    -- Participants (stored as JSON array of user IDs)
    participants TEXT NOT NULL DEFAULT '[]', -- JSON: ["user_id_1", "user_id_2"]
    
    -- Last Message Info (denormalized for performance)
    last_message_id TEXT,
    last_message_content TEXT,
    last_message_sender_id TEXT,
    last_message_timestamp TEXT,
    
    -- Unread Counts (JSON object: {"user_id_1": 0, "user_id_2": 3})
    unread_counts TEXT DEFAULT '{}',
    
    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_chats_updated_at ON chats(updated_at DESC);

-- ============================================================================
-- 10. MESSAGES TABLE (Individual messages within chats)
-- ============================================================================
CREATE TABLE IF NOT EXISTS messages (
    messages_id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4)))),
    chat_id TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    content TEXT NOT NULL,
    
    -- Attachments (JSON array for future use)
    attachments TEXT DEFAULT '[]',
    
    -- Metadata
    timestamp TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (chat_id) REFERENCES chats(chats_id) ON DELETE CASCADE,
    FOREIGN KEY (sender_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE INDEX idx_messages_chat_id ON messages(chat_id);
CREATE INDEX idx_messages_sender_id ON messages(sender_id);
CREATE INDEX idx_messages_timestamp ON messages(timestamp DESC);

-- 11. NOTIFICATIONS TABLE (User notifications)
CREATE TABLE IF NOT EXISTS notifications (
    notifications_id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4)))),
    user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE NO ACTION ON UPDATE CASCADE,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    type TEXT DEFAULT 'info' CHECK(type IN ('info', 'success', 'warning')),
    is_read INTEGER DEFAULT 0,
    read_at DATETIME,
    action_url TEXT,
    metadata TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL
);

-- 12. SETTINGS TABLE (Application settings)
CREATE TABLE IF NOT EXISTS settings (
    settings_id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4)))),
    key TEXT NOT NULL UNIQUE,
    value TEXT,
    type TEXT CHECK(type IN ('string', 'number', 'boolean', 'json')),
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL
);

-- ============================================================================
-- TRIGGERS (Auto-update timestamps and maintain data integrity)
-- ============================================================================

-- Update 'updated_at' trigger for users
CREATE TRIGGER IF NOT EXISTS update_users_updated_at 
AFTER UPDATE ON users
FOR EACH ROW
BEGIN
    UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE user_id = NEW.user_id;
END;

-- Update 'updated_at' trigger for engineers
CREATE TRIGGER IF NOT EXISTS update_engineers_updated_at 
AFTER UPDATE ON engineers
FOR EACH ROW
BEGIN
    UPDATE engineers SET updated_at = CURRENT_TIMESTAMP WHERE engineer_id = NEW.engineer_id;
END;

-- Update 'updated_at' trigger for project_managers
CREATE TRIGGER IF NOT EXISTS update_project_managers_updated_at 
AFTER UPDATE ON project_managers
FOR EACH ROW
BEGIN
    UPDATE project_managers SET updated_at = CURRENT_TIMESTAMP WHERE project_managers_id = NEW.project_managers_id;
END;

-- Update 'updated_at' trigger for jobs
CREATE TRIGGER IF NOT EXISTS update_jobs_updated_at 
AFTER UPDATE ON jobs
FOR EACH ROW
BEGIN
    UPDATE jobs SET updated_at = CURRENT_TIMESTAMP WHERE jobs_id = NEW.jobs_id;
END;

-- Update 'updated_at' trigger for applications
CREATE TRIGGER IF NOT EXISTS update_applications_updated_at 
AFTER UPDATE ON applications
FOR EACH ROW
BEGIN
    UPDATE applications SET updated_at = CURRENT_TIMESTAMP WHERE applications_id = NEW.applications_id;
END;

-- Update 'updated_at' trigger for projects
CREATE TRIGGER IF NOT EXISTS update_projects_updated_at 
AFTER UPDATE ON projects
FOR EACH ROW
BEGIN
    UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE projects_id = NEW.projects_id;
END;

-- Update 'updated_at' trigger for interviews
CREATE TRIGGER IF NOT EXISTS update_interviews_updated_at 
AFTER UPDATE ON interviews
FOR EACH ROW
BEGIN
    UPDATE interviews SET updated_at = CURRENT_TIMESTAMP WHERE interviews_id = NEW.interviews_id;
END;

-- Update 'updated_at' trigger for chats
CREATE TRIGGER IF NOT EXISTS update_chats_updated_at 
AFTER UPDATE ON chats
FOR EACH ROW
BEGIN
    UPDATE chats SET updated_at = CURRENT_TIMESTAMP WHERE chats_id = NEW.chats_id;
END;

-- Increment job applications count when new application is created
CREATE TRIGGER IF NOT EXISTS increment_job_applications_count
AFTER INSERT ON applications
FOR EACH ROW
BEGIN
    UPDATE jobs 
    SET applications_count = applications_count + 1 
    WHERE jobs_id = NEW.job_id;
END;

-- Decrement job applications count when application is deleted
CREATE TRIGGER IF NOT EXISTS decrement_job_applications_count
AFTER DELETE ON applications
FOR EACH ROW
BEGIN
    UPDATE jobs 
    SET applications_count = applications_count - 1 
    WHERE jobs_id = OLD.job_id;
END;

-- Update chat last message when new message is sent
CREATE TRIGGER IF NOT EXISTS update_chat_last_message
AFTER INSERT ON messages
FOR EACH ROW
BEGIN
    UPDATE chats
    SET last_message_id = NEW.messages_id,
        last_message_content = NEW.content,
        last_message_sender_id = NEW.sender_id,
        last_message_timestamp = NEW.timestamp,
        updated_at = CURRENT_TIMESTAMP
    WHERE chats_id = NEW.chat_id;
END;

-- Verify foreign keys are enabled
PRAGMA foreign_keys;

-- Display schema version info
SELECT 'STECHAD SQLite3 Database Schema v1.0 - Ready for Production' AS status;
