import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import User from '../models/user';
import dotenv from 'dotenv';

dotenv.config();

const fixAdminPassword = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI!);
    console.log('✅ Connected to MongoDB');

    // Find the admin user
    const adminUser = await User.findOne({ email: 'pvu7999@gmail.com' });
    
    if (!adminUser) {
      console.log('❌ Admin user not found');
      return;
    }

    console.log('🔍 Current admin user details:');
    console.log('   Email:', adminUser.email);
    console.log('   Role:', adminUser.role);
    console.log('   Current password hash:', adminUser.password);
    console.log('   Password hash length:', adminUser.password?.length);

    // Test với bcrypt hash hiện tại
    const testCurrentHash = await bcrypt.compare('admin123', adminUser.password);
    console.log('   Test current hash with "admin123":', testCurrentHash);

    // Tạo hash mới ĐÚNG CÁCH
    const saltRounds = 12;
    const newHashedPassword = await bcrypt.hash('admin123', saltRounds);
    
    console.log('🔄 Updating password...');
    console.log('   New hash length:', newHashedPassword.length);
    console.log('   New hash prefix:', newHashedPassword.substring(0, 20));

    // Update password
    adminUser.password = newHashedPassword;
    await adminUser.save();

    console.log('✅ Password updated successfully');

    // Verify the new password works
    const testNewHash = await bcrypt.compare('admin123', newHashedPassword);
    console.log('✅ New password verification:', testNewHash);

    // Verify directly from database
    const updatedUser = await User.findOne({ email: 'pvu7999@gmail.com' }).select('+password');
    const finalTest = await bcrypt.compare('admin123', updatedUser!.password);
    console.log('✅ Final verification from DB:', finalTest);

    if (finalTest) {
      console.log('🎉 SUCCESS! Admin can now login with:');
      console.log('   📧 Email: pvu7999@gmail.com');
      console.log('   🔑 Password: admin123');
    } else {
      console.log('❌ FAILED! Password still not working');
    }

  } catch (error) {
    console.error('❌ Error fixing admin password:', error);
  } finally {
    await mongoose.disconnect();
  }
};

fixAdminPassword();