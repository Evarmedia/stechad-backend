-- ============================================================================
-- STECHAD Platform - Complete PostgreSQL Database Schema
-- ============================================================================
-- This script creates all tables, indexes, triggers
-- for the STECHAD job matching and project management platform.
-- 
-- Entities: Users, Engineers, Project Managers, Admin, Jobs, 
--           Applications, Projects, Interviews, Settings, Chats, Messages, Notifications
-- ============================================================================

-- Enable foreign key constraints (CRITICAL for PostgreSQL)
SET CONSTRAINTS ALL IMMEDIATE;

-- ============================================================================
-- 1. USERS TABLE (Authentication Base)
-- ============================================================================
CREATE TABLE IF NOT EXISTS users (
    user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    role TEXT CHECK(role IN ('super_admin', 'admin', 'project_manager', 'engineer', 'staff')) NOT NULL,
    first_name TEXT,
    last_name TEXT,
    phone_number TEXT,
    is_verified BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    avatar_object_name TEXT,
    country TEXT,
    city TEXT,
    location_sharing_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    location_permission_status TEXT NOT NULL DEFAULT 'not_asked' CHECK(location_permission_status IN ('not_asked', 'granted', 'denied', 'unavailable')),
    browser_latitude DECIMAL(10, 7),
    browser_longitude DECIMAL(10, 7),
    browser_location_accuracy DECIMAL(10, 2),
    browser_location_updated_at TIMESTAMPTZ,
    last_login TIMESTAMPTZ,
    reset_password_token TEXT,
    reset_password_expires TIMESTAMPTZ,
    referrer_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);
CREATE UNIQUE INDEX users_single_super_admin ON users(role) WHERE role = 'super_admin';

-- ============================================================================
-- 2. ENGINEERS TABLE (Engineer-specific data)
-- ============================================================================
CREATE TABLE IF NOT EXISTS engineers (
    engineer_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE,
    
    -- Personal Information
    date_of_birth DATE, -- Format: MM-DD
    open_to_nearby_cities BOOLEAN,
    
    -- Language & Eligibility
    languages TEXT[] DEFAULT '{}', -- Array: ['English', 'French']
    language_proficiency TEXT CHECK(language_proficiency IN ('basic', 'conversational', 'fluent', 'native')),
    has_drivers_license BOOLEAN,
    has_car BOOLEAN,
    is_native BOOLEAN,
    work_authorized BOOLEAN,
    
    -- Professional Information
    specialization TEXT[] DEFAULT '{}', -- Array: ['Network Administration', 'Cloud Computing']
    skill_level TEXT CHECK(skill_level IN ('beginner', 'intermediate', 'advanced', 'expert')),
    years_of_experience REAL,
    certifications TEXT[] DEFAULT '{}', -- Array: ['CompTIA A+', 'AWS Certified']
    project_types TEXT[] DEFAULT '{}', -- Array: ['Full-time', 'Contract', 'Dispatch']
    
    -- Additional Information
    open_to_training BOOLEAN,
    is_freelancer BOOLEAN,
    follows_linkedin BOOLEAN,
    referee_info TEXT, -- Format: "Name, email@example.com"
    newsletter BOOLEAN,
    special_preferences TEXT,
    cv_object_name TEXT,
    
    -- Status & Metadata
    is_vetted BOOLEAN DEFAULT FALSE,
    vetted_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
    availability TEXT DEFAULT 'available' CHECK(availability IN ('available', 'busy', 'unavailable')),
    status TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive', 'suspended')),

    is_onboarded BOOLEAN DEFAULT TRUE,
    onboarded_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
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
    project_managers_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE,
    company TEXT,
    bio TEXT,
    status TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
    total_projects INTEGER DEFAULT 0,
    total_hires INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE INDEX idx_project_managers_user_id ON project_managers(user_id);
CREATE INDEX idx_project_managers_status ON project_managers(status);

-- ============================================================================
-- 4. ADMIN TABLE (Admin-specific data)
-- ============================================================================
CREATE TABLE IF NOT EXISTS admins (
    admin_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
    permissions TEXT[] DEFAULT '{}',
    is_super_admin BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- INVITES TABLE (User invitations)
-- ============================================================================
CREATE TABLE IF NOT EXISTS invites (
    invite_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL,
    temp_password TEXT NOT NULL,
    role TEXT CHECK(role IN ('project_manager', 'engineer')) NOT NULL,
    first_name TEXT,
    token TEXT NOT NULL UNIQUE,
    invited_by_user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE SET NULL,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'expired')),
    sent_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    responded_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 5. JOBS TABLE (Job postings created by PMs)
-- ============================================================================
CREATE TABLE IF NOT EXISTS jobs (
    jobs_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    posted_by UUID NOT NULL, -- PM that created the job
    
    -- Basic Information
    title TEXT NOT NULL,
    company TEXT NOT NULL,
    location TEXT NOT NULL,
    description TEXT NOT NULL,
    
    -- Job Details
    employment_type TEXT CHECK(employment_type IN ('full-time', 'contract', 'part-time')),
    salary TEXT,
    duration TEXT, -- "3 months", "6 months", etc.
    openings INTEGER DEFAULT 1,
    experience_level TEXT, -- "Junior", "Mid level", "Senior"
    
    -- Requirements & Skills
    skills_required TEXT[] DEFAULT '{}', -- Array: ['React', 'TypeScript', 'Node.js']
    responsibilities TEXT[] DEFAULT '{}', -- Array
    requirements TEXT[] DEFAULT '{}', -- Array
    
    -- Configuration
    remote BOOLEAN DEFAULT FALSE,
    status TEXT DEFAULT 'active' CHECK(status IN ('active', 'closed', 'draft')),
    
    -- Metadata
    deadline TIMESTAMPTZ,
    applications_count INTEGER DEFAULT 0,
    posted_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (posted_by) REFERENCES users(user_id) ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX idx_jobs_pm_id ON jobs(posted_by);
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_posted_at ON jobs(posted_at DESC);
CREATE INDEX idx_jobs_location ON jobs(location);

-- ============================================================================
-- 6. APPLICATIONS TABLE (Engineers applying to jobs)
-- ============================================================================
CREATE TABLE IF NOT EXISTS applications (
    applications_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL,
    engineer_id UUID NOT NULL,
    job_title TEXT NOT NULL,
    engineer_name TEXT,
    
    -- Application Details
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'reviewed', 'accepted', 'rejected')),
    experience TEXT,
    skills TEXT[] DEFAULT '{}', -- Array
    
    -- Metadata
    reviewed_at TIMESTAMPTZ,
    reviewed_by UUID REFERENCES users (user_id) ON DELETE SET NULL ON UPDATE CASCADE,
    feedback TEXT,
    applied_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (job_id) REFERENCES jobs(jobs_id) ON DELETE NO ACTION ON UPDATE CASCADE,
    FOREIGN KEY (engineer_id) REFERENCES users(user_id) ON DELETE CASCADE,
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
    projects_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_managers_user_id UUID NOT NULL,
    
    -- Project Information
    title TEXT NOT NULL,
    description TEXT,
    -- job_id UUID REFERENCES jobs (jobs_id) ON DELETE SET NULL ON UPDATE CASCADE,
    engineer_user_id UUID REFERENCES users (user_id) ON DELETE SET NULL ON UPDATE CASCADE,
    status TEXT DEFAULT 'planning' CHECK(status IN ('planning', 'in_progress', 'completed', 'on_hold', 'cancelled')),
    priority TEXT DEFAULT 'medium' CHECK(priority IN ('high', 'medium', 'low', 'critical')),
    progress INTEGER DEFAULT 0 CHECK(progress >= 0 AND progress <= 100),
    
    -- Team & Tasks
    team TEXT[] DEFAULT '{}', -- Array: ['John Doe', 'Jane Smith']
    tasks JSONB DEFAULT '[]', -- JSON array of objects: [{"id": 1, "title": "...", "status": "...", "assignee": "..."}]
    
    -- Timeline
    start_date TIMESTAMPTZ,
    deadline TIMESTAMPTZ, -- ISO date: "2024-12-31"
    feedback TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (project_managers_user_id) REFERENCES users(user_id) ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX idx_projects_project_managers_id ON projects(project_managers_user_id);
CREATE INDEX idx_projects_job ON projects(job_id);
CREATE INDEX idx_projects_engr ON projects(engineer_user_id);
CREATE INDEX idx_projects_status ON projects(status);
CREATE INDEX idx_projects_priority ON projects(priority);
CREATE INDEX idx_projects_deadline ON projects(deadline);

-- ============================================================================
-- 8. INTERVIEWS TABLE (Interview scheduling)
-- ============================================================================
CREATE TABLE IF NOT EXISTS interviews (
    interviews_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Candidate Information
    candidate_id UUID NOT NULL,
    candidate_name TEXT NOT NULL,
    candidate_email TEXT NOT NULL,
    
    -- Interviewer Information
    interviewer_id UUID NOT NULL,
    interviewer_email TEXT NOT NULL,
    
    -- Job Information
    job_id UUID NOT NULL,
    job_title TEXT NOT NULL,
    
    -- Interview Details
    date_time TIMESTAMPTZ NOT NULL, -- ISO 8601: "2024-01-15T10:00:00Z"
    duration INTEGER DEFAULT 60, -- minutes
    phone_number TEXT,
    status TEXT DEFAULT 'scheduled' CHECK(status IN ('scheduled', 'completed', 'cancelled', 'rescheduled')),
    
    -- Links & Notes
    zoom_link TEXT,
    calendar_event_id TEXT,
    notes TEXT,
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    
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
    chats_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Participants (stored as JSON array of user IDs)
    participants TEXT[] NOT NULL, -- Array: ['user_id_1', 'user_id_2']
    
    -- Last Message Info (denormalized for performance)
    last_message_id UUID,
    last_message_content TEXT,
    last_message_sender_id UUID,
    last_message_timestamp TIMESTAMPTZ,
    
    -- Unread Counts (JSON object: {"user_id_1": 0, "user_id_2": 3})
    unread_counts JSONB DEFAULT '{}'::jsonb,
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_chats_updated_at ON chats(updated_at DESC);

-- ============================================================================
-- 10. MESSAGES TABLE (Individual messages within chats)
-- ============================================================================
CREATE TABLE IF NOT EXISTS messages (
    messages_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_id UUID NOT NULL,
    sender_id UUID NOT NULL,
    content TEXT NOT NULL,
    
    -- Attachments (JSON array for future use)
    attachments TEXT[] DEFAULT '{}',
    
    -- Metadata
    timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (chat_id) REFERENCES chats(chats_id) ON DELETE CASCADE,
    FOREIGN KEY (sender_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE INDEX idx_messages_chat_id ON messages(chat_id);
CREATE INDEX idx_messages_sender_id ON messages(sender_id);
CREATE INDEX idx_messages_timestamp ON messages(timestamp DESC);

-- ============================================================================
-- 11. NOTIFICATIONS TABLE (User notifications)
-- ============================================================================
CREATE TABLE IF NOT EXISTS notifications (
    notifications_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    type TEXT DEFAULT 'info' CHECK(type IN ('info', 'success', 'warning')),
    is_read BOOLEAN DEFAULT FALSE,
    read_at TIMESTAMPTZ,
    action_url TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 12. SETTINGS TABLE (Application settings)
-- ============================================================================
CREATE TABLE IF NOT EXISTS settings (
    settings_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key TEXT NOT NULL UNIQUE,
    value TEXT,
    type TEXT CHECK(type IN ('string', 'number', 'boolean', 'json')),
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 13. REFERRALS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS referrals (
    referral_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    referrer_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    referee_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    reward_status TEXT DEFAULT 'pending' CHECK(reward_status IN ('pending', 'claimed', 'expired')),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (referrer_id, referee_id)
);

CREATE INDEX idx_referrals_referrer_id ON referrals(referrer_id);
CREATE INDEX idx_referrals_referee_id ON referrals(referee_id);

-- ============================================================================
-- 14. REWARDS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS rewards (
    reward_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reward_type TEXT NOT NULL CHECK(reward_type IN ('referral', 'signup', 'milestone')),
    reward_amount REAL NOT NULL,
    reward_description TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 15. USER REWARDS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_rewards (
    user_reward_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    reward_id UUID NOT NULL REFERENCES rewards(reward_id) ON DELETE CASCADE,
    reward_status TEXT DEFAULT 'unclaimed' CHECK(reward_status IN ('unclaimed', 'claimed', 'expired')),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, reward_id)
);

CREATE INDEX idx_user_rewards_user_id ON user_rewards(user_id);
CREATE INDEX idx_user_rewards_reward_id ON user_rewards(reward_id);

-- ============================================================================
-- TRIGGERS (maintain data integrity)
-- ============================================================================

-- Increment job applications count when new application is created
CREATE OR REPLACE FUNCTION increment_job_applications_count() RETURNS TRIGGER AS $$
BEGIN
    UPDATE jobs
    SET applications_count = applications_count + 1
    WHERE jobs_id = NEW.job_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER increment_job_applications_count
AFTER INSERT ON applications
FOR EACH ROW EXECUTE FUNCTION increment_job_applications_count();

-- Decrement job applications count when application is deleted
CREATE OR REPLACE FUNCTION decrement_job_applications_count() RETURNS TRIGGER AS $$
BEGIN
    UPDATE jobs
    SET applications_count = applications_count - 1
    WHERE jobs_id = OLD.job_id;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER decrement_job_applications_count
AFTER DELETE ON applications
FOR EACH ROW EXECUTE FUNCTION decrement_job_applications_count();

-- Update chat last message when new message is sent
CREATE OR REPLACE FUNCTION update_chat_last_message() RETURNS TRIGGER AS $$
BEGIN
    UPDATE chats
    SET last_message_id = NEW.messages_id,
        last_message_content = NEW.content,
        last_message_sender_id = NEW.sender_id,
        last_message_timestamp = NEW.timestamp,
        updated_at = CURRENT_TIMESTAMP
    WHERE chats_id = NEW.chat_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_chat_last_message
AFTER INSERT ON messages
FOR EACH ROW EXECUTE FUNCTION update_chat_last_message();

-- ============================================================================
-- VERIFY FOREIGN KEYS ARE ENABLED (PostgreSQL automatically checks foreign keys)
-- ============================================================================

-- ============================================================================
-- DISPLAY SCHEMA VERSION INFO (optional)
-- ============================================================================
SELECT 'STECHAD PostgreSQL Database Schema v1.0 - Ready for Production' AS status;
