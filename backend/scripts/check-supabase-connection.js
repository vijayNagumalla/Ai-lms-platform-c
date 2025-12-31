/**
 * Script to diagnose Supabase connection issues
 * Checks DNS resolution, network connectivity, and project status
 * 
 * Usage: node backend/scripts/check-supabase-connection.js
 */

import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dns from 'dns';
import { promisify } from 'util';
import https from 'https';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '..', '.env') });

const resolve4 = promisify(dns.resolve4);
const lookup = promisify(dns.lookup);

async function checkDnsResolution(hostname) {
  console.log(`\n🔍 Checking DNS resolution for ${hostname}...`);
  try {
    const addresses = await resolve4(hostname);
    console.log(`✅ DNS resolution successful:`);
    addresses.forEach(addr => console.log(`   - ${addr}`));
    return true;
  } catch (error) {
    console.log(`❌ DNS resolution failed: ${error.message}`);
    console.log(`   This means the hostname cannot be resolved.`);
    return false;
  }
}

async function checkHostnameLookup(hostname) {
  console.log(`\n🔍 Checking hostname lookup for ${hostname}...`);
  try {
    const result = await lookup(hostname);
    console.log(`✅ Hostname lookup successful:`);
    console.log(`   - Address: ${result.address}`);
    console.log(`   - Family: IPv${result.family}`);
    return true;
  } catch (error) {
    console.log(`❌ Hostname lookup failed: ${error.message}`);
    return false;
  }
}

async function checkHttpsConnection(url) {
  console.log(`\n🔍 Checking HTTPS connection to ${url}...`);
  return new Promise((resolve) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname,
      method: 'GET',
      timeout: 5000,
      rejectUnauthorized: false
    };

    const req = https.request(options, (res) => {
      console.log(`✅ HTTPS connection successful:`);
      console.log(`   - Status Code: ${res.statusCode}`);
      console.log(`   - Status Message: ${res.statusMessage}`);
      resolve(true);
    });

    req.on('error', (error) => {
      console.log(`❌ HTTPS connection failed: ${error.message}`);
      if (error.code === 'ENOTFOUND') {
        console.log(`   This confirms DNS resolution is failing.`);
      } else if (error.code === 'ECONNREFUSED') {
        console.log(`   Connection refused - server might be down.`);
      } else if (error.code === 'ETIMEDOUT') {
        console.log(`   Connection timeout - network or firewall issue.`);
      }
      resolve(false);
    });

    req.on('timeout', () => {
      req.destroy();
      console.log(`❌ Connection timeout after 5 seconds`);
      resolve(false);
    });

    req.end();
  });
}

async function checkSupabaseProject(url) {
  console.log(`\n🔍 Checking Supabase project status...`);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(5000)
    });
    
    if (response.ok) {
      console.log(`✅ Supabase project is accessible`);
      console.log(`   - Status: ${response.status} ${response.statusText}`);
      return true;
    } else {
      console.log(`⚠️  Supabase project returned status: ${response.status}`);
      if (response.status === 404) {
        console.log(`   This might indicate the project doesn't exist or is paused.`);
      }
      return false;
    }
  } catch (error) {
    console.log(`❌ Failed to check Supabase project: ${error.message}`);
    if (error.name === 'AbortError') {
      console.log(`   Request timed out after 5 seconds.`);
    }
    return false;
  }
}

async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('🔧 Supabase Connection Diagnostic Tool');
  console.log('='.repeat(60));

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl) {
    console.error('\n❌ ERROR: SUPABASE_URL is not set in your .env file');
    console.error('   Please set it in backend/.env');
    console.error('   Format: https://[project-ref].supabase.co');
    process.exit(1);
  }

  console.log(`\n📋 Configuration:`);
  console.log(`   SUPABASE_URL: ${supabaseUrl}`);
  console.log(`   SUPABASE_KEY: ${supabaseKey ? '✅ Set' : '❌ Not set'}`);

  // Extract hostname from URL
  let hostname;
  try {
    const urlObj = new URL(supabaseUrl);
    hostname = urlObj.hostname;
  } catch (error) {
    console.error(`\n❌ Invalid SUPABASE_URL format: ${supabaseUrl}`);
    console.error('   Expected format: https://[project-ref].supabase.co');
    process.exit(1);
  }

  console.log(`\n📡 Hostname: ${hostname}`);

  // Run diagnostics
  const dnsOk = await checkDnsResolution(hostname);
  const lookupOk = await checkHostnameLookup(hostname);
  const httpsOk = await checkHttpsConnection(supabaseUrl);
  const projectOk = await checkSupabaseProject(supabaseUrl);

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 Diagnostic Summary');
  console.log('='.repeat(60));
  console.log(`   DNS Resolution:     ${dnsOk ? '✅ OK' : '❌ FAILED'}`);
  console.log(`   Hostname Lookup:    ${lookupOk ? '✅ OK' : '❌ FAILED'}`);
  console.log(`   HTTPS Connection:   ${httpsOk ? '✅ OK' : '❌ FAILED'}`);
  console.log(`   Project Access:     ${projectOk ? '✅ OK' : '❌ FAILED'}`);

  if (!dnsOk || !lookupOk) {
    console.log('\n💡 Troubleshooting Steps:');
    console.log('   1. Check if your Supabase project is paused:');
    console.log('      - Go to https://supabase.com/dashboard');
    console.log('      - Check if your project shows as "Paused"');
    console.log('      - If paused, you need to restore it');
    console.log('\n   2. Verify the project reference in SUPABASE_URL:');
    console.log('      - Go to Supabase Dashboard → Settings → API');
    console.log('      - Check the "Project URL" matches your SUPABASE_URL');
    console.log('\n   3. Check network connectivity:');
    console.log('      - Try: ping supabase.com');
    console.log('      - Check if you can access https://supabase.com');
    console.log('\n   4. Check DNS settings:');
    console.log('      - Try: nslookup ' + hostname);
    console.log('      - If DNS fails, try using a different DNS server (e.g., 8.8.8.8)');
    console.log('\n   5. Check firewall/proxy settings:');
    console.log('      - Ensure port 443 (HTTPS) is not blocked');
    console.log('      - Check if a corporate proxy is interfering');
  } else if (!httpsOk || !projectOk) {
    console.log('\n💡 Troubleshooting Steps:');
    console.log('   1. The hostname resolves but connection fails');
    console.log('   2. Check if the Supabase project is active (not paused)');
    console.log('   3. Verify your network/firewall allows HTTPS connections');
    console.log('   4. Try accessing the URL in a browser');
  } else {
    console.log('\n✅ All checks passed! Your Supabase connection should work.');
    console.log('   If you\'re still experiencing issues, check:');
    console.log('   - SUPABASE_SERVICE_ROLE_KEY is correct');
    console.log('   - Your application code is handling errors properly');
  }

  console.log('\n');
}

main().catch(error => {
  console.error('\n❌ Diagnostic script error:', error.message);
  process.exit(1);
});

