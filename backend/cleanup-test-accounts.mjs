/**
 * One-off: removes the four @chax.test accounts that were created against the
 * live database during development, and the verification codes that belong to
 * them. Refuses to touch anything that is a verified account.
 *
 * Run once from backend/, then delete this file:
 *   node cleanup-test-accounts.mjs
 */
import mongoose from 'mongoose';
import { env } from './src/config/env.js';
import { User } from './src/models/User.js';
import { Otp } from './src/models/Otp.js';

const EMAILS = ['manish@chax.test', 'priya@chax.test', 'sam@chax.test', 'nadia@chax.test'];

await mongoose.connect(env.mongoUri);

const found = await User.find({ email: { $in: EMAILS } })
  .select('email emailVerified createdAt')
  .lean();

if (!found.length) {
  console.log('Nothing to remove — none of those accounts exist.');
} else {
  found.forEach((u) => console.log(' found', u.email, '| verified:', u.emailVerified));

  if (found.some((u) => u.emailVerified)) {
    console.log('\nRefusing to delete: one of these is a verified account.');
  } else {
    const users = await User.deleteMany({ email: { $in: EMAILS }, emailVerified: false });
    const otps = await Otp.deleteMany({ email: { $in: EMAILS } });
    console.log('\nRemoved', users.deletedCount, 'accounts and', otps.deletedCount, 'codes.');
  }
}

await mongoose.disconnect();
