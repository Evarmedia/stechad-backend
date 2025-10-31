@@ .. @@
 -- User model relationships
 User.hasMany(Referral, { foreignKey: 'referrer_id', as: 'referralsMade' });
 User.hasMany(Referral, { foreignKey: 'referee_id', as: 'referralsReceived' });
-User.belongsTo(User, { foreignKey: 'referrer_id', as: 'referrer', onDelete: 'SET NULL' });
+User.belongsTo(User, { foreignKey: 'referred_by', as: 'referrer', onDelete: 'SET NULL' });
+User.hasMany(User, { foreignKey: 'referred_by', as: 'referees' });

 -- user - Invite (One-to-Many)
@@ .. @@
     referrer_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
     referee_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
-    reward_status TEXT DEFAULT 'pending' CHECK(reward_status IN ('pending', 'claimed', 'expired')),
+    referral_code VARCHAR(10) NOT NULL,
+    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'completed', 'expired')),
+    reward_claimed BOOLEAN DEFAULT FALSE,
+    completed_at TIMESTAMPTZ,
     created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
     updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
-    UNIQUE (referrer_id, referee_id)
+    UNIQUE (referrer_id, referee_id),
+    UNIQUE (referral_code)
 );

 CREATE INDEX idx_referrals_referrer_id ON referrals(referrer_id);
 CREATE INDEX idx_referrals_referee_id ON referrals(referee_id);
+CREATE INDEX idx_referrals_code ON referrals(referral_code);

 -- ============================================================================
 -- 14. REWARDS TABLE
@@ -344,8 +349,11 @@ CREATE TABLE IF NOT EXISTS rewards (
     reward_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     reward_type TEXT NOT NULL CHECK(reward_type IN ('referral', 'signup', 'milestone')),
-    reward_amount REAL NOT NULL,
+    reward_amount DECIMAL(10,2) NOT NULL,
+    reward_currency VARCHAR(3) DEFAULT 'USD',
     reward_description TEXT,
+    is_active BOOLEAN DEFAULT TRUE,
     created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
     updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
 );
@@ -358,8 +366,13 @@ CREATE TABLE IF NOT EXISTS user_rewards (
     user_reward_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
     reward_id UUID NOT NULL REFERENCES rewards(reward_id) ON DELETE CASCADE,
-    reward_status TEXT DEFAULT 'unclaimed' CHECK(reward_status IN ('unclaimed', 'claimed', 'expired')),
+    referral_id UUID REFERENCES referrals(referral_id) ON DELETE SET NULL,
+    reward_status TEXT DEFAULT 'pending' CHECK(reward_status IN ('pending', 'approved', 'paid', 'expired')),
+    reward_amount DECIMAL(10,2) NOT NULL,
+    claimed_at TIMESTAMPTZ,
+    expires_at TIMESTAMPTZ,
     created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
     updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
-    UNIQUE (user_id, reward_id)
+    UNIQUE (user_id, reward_id, referral_id)
 );

@@ .. @@
 CREATE INDEX idx_user_rewards_reward_id ON user_rewards(reward_id);

+-- Add referral fields to users table
+ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code VARCHAR(10) UNIQUE;
+ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by UUID REFERENCES users(user_id) ON DELETE SET NULL;
+
+CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code);
+CREATE INDEX IF NOT EXISTS idx_users_referred_by ON users(referred_by);
+
+-- Update chats table for better chat system
+ALTER TABLE chats ADD COLUMN IF NOT EXISTS chat_type TEXT DEFAULT 'direct' CHECK(chat_type IN ('direct', 'group', 'support'));
+ALTER TABLE chats ADD COLUMN IF NOT EXISTS chat_name VARCHAR(255);
+ALTER TABLE chats ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
+ALTER TABLE chats ADD COLUMN IF NOT EXISTS created_by UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE;
+
+-- Update messages table for better messaging
+ALTER TABLE messages ADD COLUMN IF NOT EXISTS message_type TEXT DEFAULT 'text' CHECK(message_type IN ('text', 'image', 'file', 'system'));
+ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to UUID REFERENCES messages(messages_id) ON DELETE SET NULL;
+ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_edited BOOLEAN DEFAULT FALSE;
+ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
+ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;
+ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
+ALTER TABLE messages ADD COLUMN IF NOT EXISTS read_by JSONB DEFAULT '{}'::jsonb;
+
 -- ============================================================================
 -- TRIGGERS (maintain data integrity)