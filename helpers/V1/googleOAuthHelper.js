// helpers/googleOAuthHelper.js
import { google } from 'googleapis';
import CommonModel from '../../modules/models/mysql/commonModel/commonModel.js';
import db from '../../config/knex.js';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;

export class GoogleOAuthHelper {
  
  static getOAuth2Client() {
    return new google.auth.OAuth2(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      GOOGLE_REDIRECT_URI
    );
  }
  
  static getAuthUrl(senderId) {
    const oauth2Client = this.getOAuth2Client();
    const state = Buffer.from(JSON.stringify({ senderId })).toString('base64');
    
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/gmail.readonly'
      ],
      state: state,
      prompt: 'consent'
    });
    
    return authUrl;
  }
  
  static async getTokensFromCode(code) {
    const oauth2Client = this.getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);
    return tokens;
  }
  
  static async saveTokens(senderId, tokens) {
    const emailDetails = {
      connected: true,
      connected_at: new Date().toISOString(),
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry_date: tokens.expiry_date,
      token_type: tokens.token_type,
      scope: tokens.scope
    };
    
    await CommonModel.updateData(
      'crm_sender_emails',
      { 
        email_details: JSON.stringify(emailDetails),
        status: 'Active',
        updated_at: new Date()
      },
      `id = ${senderId}`
    );
  }
  
  static async getValidAccessToken(senderId) {
    try {
      const sender = await CommonModel.getData(
        'crm_sender_emails',
        '*',
        `id = ${senderId}`
      );
      
      if (!sender || sender.length === 0) {
        throw new Error('Sender not found');
      }
      
      const emailDetails = JSON.parse(sender[0].email_details);
      
      // Extract token data from root level
      const tokenData = {
        access_token: emailDetails.access_token,
        refresh_token: emailDetails.refresh_token,
        expiry_date: emailDetails.expiry_date,
        token_type: emailDetails.token_type,
        scope: emailDetails.scope
      };
      
      // Validate we have necessary tokens
      if (!tokenData.access_token) {
        throw new Error('No access token found');
      }
      
      console.log(`Token expiry for sender ${senderId}:`, new Date(tokenData.expiry_date));
      console.log(`Current time:`, new Date());
      console.log(`Is expired?`, tokenData.expiry_date <= Date.now());
      
      // Check if token needs refresh (add 5 minute buffer)
      const needsRefresh = tokenData.expiry_date <= Date.now() + 5 * 60 * 1000;
      
      if (needsRefresh) {
        console.log(`Token expired for sender ${senderId}, refreshing...`);
        
        if (!tokenData.refresh_token) {
          throw new Error('No refresh token available for refresh');
        }
        
        const oauth2Client = this.getOAuth2Client();
        oauth2Client.setCredentials({ refresh_token: tokenData.refresh_token });
        
        try {
          const { credentials } = await oauth2Client.refreshAccessToken();
          
          // Update token data
          const updatedEmailDetails = {
            ...emailDetails,
            access_token: credentials.access_token,
            expiry_date: credentials.expiry_date,
            refresh_token: credentials.refresh_token || tokenData.refresh_token,
            token_type: credentials.token_type || tokenData.token_type,
            scope: credentials.scope || tokenData.scope
          };
          
          await CommonModel.updateData(
            'crm_sender_emails',
            { 
              email_details: JSON.stringify(updatedEmailDetails),
              updated_at: new Date()
            },
            `id = ${senderId}`
          );
          
          console.log(`Token refreshed successfully for sender ${senderId}`);
          return credentials.access_token;
          
        } catch (refreshError) {
          console.error(`Refresh failed for sender ${senderId}:`, refreshError.message);
          
          if (refreshError.message === 'invalid_grant') {
            // Mark as needing re-authentication
            const invalidatedDetails = {
              ...emailDetails,
              connected: false,
              last_error: 'Refresh token expired or revoked - needs re-authentication'
            };
            
            await CommonModel.updateData(
              'crm_sender_emails',
              { 
                email_details: JSON.stringify(invalidatedDetails),
                status: 'Inactive',
                updated_at: new Date()
              },
              `id = ${senderId}`
            );
            
            throw new Error(`REAUTHENTICATION_REQUIRED: Please re-authenticate sender ${senderId}`);
          }
          throw refreshError;
        }
      }
      
      console.log(`Using existing token for sender ${senderId}`);
      return tokenData.access_token;
      
    } catch (error) {
      console.error(`Error in getValidAccessToken for sender ${senderId}:`, error);
      throw error;
    }
  }
  
  static async sendEmail(senderId, to, subject, bodyHtml) {
    console.log("Inside sendEmail:", senderId, to, subject);
    
    const accessToken = await this.getValidAccessToken(senderId);
    const oauth2Client = this.getOAuth2Client();
    oauth2Client.setCredentials({ access_token: accessToken });
    
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    
    const emailLines = [
      `To: ${to}`,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=utf-8',
      '',
      bodyHtml
    ];
    
    const email = emailLines.join('\r\n');
    const encodedEmail = Buffer.from(email)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    
    const response = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw: encodedEmail }
    });
    
    return {
      success: true,
      messageId: response.data.id,
      threadId: response.data.threadId
    };
  }

  static async getGmailClient(senderId) {
    const accessToken = await this.getValidAccessToken(senderId);
    const oauth2Client = this.getOAuth2Client();
    oauth2Client.setCredentials({ access_token: accessToken });
    return google.gmail({ version: 'v1', auth: oauth2Client });
  }

  // ==================== STAFF GOOGLE CALENDAR (one-way demo push) ====================
  // Separate OAuth connection per staff member — shares the same registered
  // Google redirect URI as the Gmail sender flow above (Google only allows
  // exchanging a code at the exact URI it was requested for), disambiguated
  // via `state.type` in the shared callback controller (email-campaign.js's
  // gmailCallback).

  static getCalendarAuthUrl(staffId) {
    const oauth2Client = this.getOAuth2Client();
    const state = Buffer.from(JSON.stringify({ type: 'calendar', staffId })).toString('base64');

    return oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/calendar.events'],
      state,
      prompt: 'consent',
    });
  }

  static async saveCalendarTokens(staffId, tokens) {
    const row = {
      staff_id: staffId,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry_date: tokens.expiry_date,
      token_type: tokens.token_type,
      scope: tokens.scope,
      connected: true,
      last_error: null,
      connected_at: new Date(),
    };

    const existing = await db('crm_staff_google_calendar').where('staff_id', staffId).first();
    if (existing) {
      // Google only returns a refresh_token on the very first consent — keep
      // the existing one if this re-auth didn't get a new one.
      if (!row.refresh_token) row.refresh_token = existing.refresh_token;
      await db('crm_staff_google_calendar').where('staff_id', staffId).update(row);
    } else {
      await db('crm_staff_google_calendar').insert(row);
    }
  }

  static async disconnectCalendar(staffId) {
    await db('crm_staff_google_calendar').where('staff_id', staffId).del();
  }

  static async getCalendarConnection(staffId) {
    return db('crm_staff_google_calendar').where('staff_id', staffId).first();
  }

  static async getValidCalendarAccessToken(staffId) {
    const connection = await db('crm_staff_google_calendar').where('staff_id', staffId).first();
    if (!connection || !connection.access_token) return null;

    const needsRefresh = Number(connection.expiry_date) <= Date.now() + 5 * 60 * 1000;
    if (!needsRefresh) return connection.access_token;

    if (!connection.refresh_token) {
      await db('crm_staff_google_calendar').where('staff_id', staffId).update({ connected: false, last_error: 'No refresh token — please reconnect' });
      return null;
    }

    try {
      const oauth2Client = this.getOAuth2Client();
      oauth2Client.setCredentials({ refresh_token: connection.refresh_token });
      const { credentials } = await oauth2Client.refreshAccessToken();

      await db('crm_staff_google_calendar').where('staff_id', staffId).update({
        access_token: credentials.access_token,
        expiry_date: credentials.expiry_date,
        refresh_token: credentials.refresh_token || connection.refresh_token,
        token_type: credentials.token_type || connection.token_type,
      });

      return credentials.access_token;
    } catch (error) {
      console.error(`Calendar token refresh failed for staff ${staffId}:`, error.message);
      await db('crm_staff_google_calendar').where('staff_id', staffId).update({ connected: false, last_error: 'Refresh failed — please reconnect' });
      return null;
    }
  }

  static async getCalendarClient(staffId) {
    const accessToken = await this.getValidCalendarAccessToken(staffId);
    if (!accessToken) return null;
    const oauth2Client = this.getOAuth2Client();
    oauth2Client.setCredentials({ access_token: accessToken });
    return google.calendar({ version: 'v3', auth: oauth2Client });
  }

  /**
   * Creates a Google Calendar event for a scheduled demo. Returns the new
   * event's id, or null if the staff member hasn't connected a calendar (or
   * the push otherwise fails) — callers must treat null as "skip silently,"
   * never as a reason to fail the demo scheduling itself.
   */
  static async createCalendarEvent(staffId, { summary, description, startISO, endISO, attendeeEmail }) {
    try {
      const calendar = await this.getCalendarClient(staffId);
      if (!calendar) return null;

      const connection = await this.getCalendarConnection(staffId);
      const response = await calendar.events.insert({
        calendarId: connection.calendar_id || 'primary',
        requestBody: {
          summary,
          description,
          start: { dateTime: startISO },
          end: { dateTime: endISO },
          attendees: attendeeEmail ? [{ email: attendeeEmail }] : undefined,
        },
      });

      return response.data.id;
    } catch (error) {
      console.error(`createCalendarEvent failed for staff ${staffId}:`, error.message);
      return null;
    }
  }

  static async updateCalendarEvent(staffId, eventId, { summary, description, startISO, endISO }) {
    try {
      if (!eventId) return false;
      const calendar = await this.getCalendarClient(staffId);
      if (!calendar) return false;

      const connection = await this.getCalendarConnection(staffId);
      await calendar.events.patch({
        calendarId: connection.calendar_id || 'primary',
        eventId,
        requestBody: {
          summary,
          description,
          start: startISO ? { dateTime: startISO } : undefined,
          end: endISO ? { dateTime: endISO } : undefined,
        },
      });
      return true;
    } catch (error) {
      console.error(`updateCalendarEvent failed for staff ${staffId}:`, error.message);
      return false;
    }
  }

  static async deleteCalendarEvent(staffId, eventId) {
    try {
      if (!eventId) return false;
      const calendar = await this.getCalendarClient(staffId);
      if (!calendar) return false;

      const connection = await this.getCalendarConnection(staffId);
      await calendar.events.delete({ calendarId: connection.calendar_id || 'primary', eventId });
      return true;
    } catch (error) {
      // A 410/404 just means it's already gone — not worth surfacing.
      console.error(`deleteCalendarEvent failed for staff ${staffId}:`, error.message);
      return false;
    }
  }
}

export default GoogleOAuthHelper;