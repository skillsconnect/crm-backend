import crypto from 'crypto';
const VERSION = process.env.WEBSITE_VERSION;
const { default: commonModel } = await import(
  `../../../Modules/Models/Website/MySQL/commonModel/commonModel.js`
);
import axios from 'axios';
import { sendMail,sendInstantMail } from './mail.helper.js';

// to encrypt data in aes and base64
export const encrypt = (data) => {
  const algorithm = 'aes-256-cbc';

  const secretKey = "RGjB6qIBXGz9mmNVCpwwiHpW0N3s3jR+";

  console.log(secretKey);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(algorithm, secretKey, iv);

  let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
  encrypted += cipher.final('hex');

  let encData = {
    iv: iv.toString('hex'),
    content: encrypted,

  };

  let encryptedData = Buffer.from(JSON.stringify(encData)).toString('base64');
  // console.log(encryptedData);
  // this.decrypt(encryptedData);
  return encryptedData;
};

// const crypto = require('crypto');

export const decrypt = (encryptedData) => {
  const algorithm = 'aes-256-cbc';

  const secretKey = "RGjB6qIBXGz9mmNVCpwwiHpW0N3s3jR+";


  const encData = JSON.parse(Buffer.from(encryptedData, 'base64').toString('utf8'));
  const iv = Buffer.from(encData.iv, 'hex');
  const encryptedContent = encData.content;

  const decipher = crypto.createDecipheriv(algorithm, secretKey, iv);

  let decrypted = decipher.update(encryptedContent, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  // console.log(decrypted);
  return JSON.parse(decrypted);
};

export const decryptBase64 = (encryptedData) => {

  return Buffer.from(encryptedData , "base64").toString("utf-8");
}

export const slugify = (text) => {

    // Replace non-letter or digits by -
    text = text.replace(/[^a-zA-Z0-9]+/g, '-');
    // Transliterate
    // text = diacritics.remove(text);
    // Remove unwanted characters
    text = text.replace(/[^-\w]+/g, '');
    // Trim
    text = text.trim('-');
    // Remove duplicate -
    text = text.replace(/-+/g, '-');
    // Lowercase
    text = text.toLowerCase();
    if (text.length === 0) {
        return 'n-a';
    }
    return text;

}

export const arrayFormationFeature = async(array, label) => {
  const returnArray = {};

  array.forEach(val => {
    const labelKey = val[label];         // e.g. "package_id", "category", etc.
    const featureId = val.featureid;     // from val['featureid']

    if (!returnArray[labelKey]) {
      returnArray[labelKey] = {};        // create group if not exists
    }

    returnArray[labelKey][featureId] = val; // assign object
  });

  return returnArray;
}

export const getEnum = (model, field) => {
  console.log(model, field);
  const schema = model.schema;
    if (schema.path(field) && schema.path(field).enumValues) {
        return schema.path(field).enumValues;
    }
    return null; // Field does not exist or is not an enum
}

export const replaceApostrophe = (text) => {
  return text.trim().replace(/'/g, '');
}

export const getTodayDateIST = () => {
  const now = new Date();
  const istOffset = 330; // IST is UTC + 5:30
  const istTime = new Date(now.getTime() + (istOffset * 60000));
  return istTime.toISOString().split('T')[0]; // YYYY-MM-DD
};

// check package expiry

export const checkPackageExpireDate = async (company_id) =>{

  if(company_id){
    const condition = `ups_package_user_mapping.company_id = '${company_id}' AND ups_package_user_mapping.status = 'Active' AND ups_package_user_mapping.is_deleted = 'No'`;
    const mainTable = ['ups_package_user_mapping',['ups_package_user_mapping.*']];
    const joinTable = [
      ['','ups_packages','ups_packages.id = ups_package_user_mapping.package_id',['ups_packages.package_name,ups_packages.package_slug']]
    ];
    const result = await commonModel.joinFetch(mainTable,joinTable,condition);
    return result;
  }else{
    return false;
  }
}

// check mail exist or not

export const checkMailExist = async (email,id = null) => {

  let condition = `email = '${email}'`;
  if(id){
    condition += ` AND id != ${id}`;
  }

  // console.log("condition",condition);
  // return false;
  return await commonModel.getData("ups_users","email",condition);
}

export const checkMobileExist = async (mobile,id =null) => {
  let condition = `mobile = '${mobile}'`;
  if(id){
    condition += ` AND id != ${id}`;
  } 
  return await commonModel.getData("ups_users","mobile",condition);
}

export const checkWhatsappExist = async (whatsapp_number,id=null) => {
  let condition = `whatsapp_number = '${whatsapp_number}'`;
  if(id){
    condition += ` AND id != ${id}`;
  } 
  return await commonModel.getData("ups_users","mobile",condition);
}

export const generateMD5Hash = async (data) => {
    console.log(data);
    console.log(crypto.createHash('md5').update(data).digest('hex'))
    return crypto.createHash('md5').update(data).digest('hex');
}

export const sanitizePhoneNumber = async (phone) => {
    if (!phone) return '';

    // Remove all non-digit characters
    const digits = phone.replace(/\D/g, '');

    // Remove leading country codes like 91, +91, 0091
    if (digits.length > 10 && (digits.startsWith('91') || digits.startsWith('0091'))) {
        return digits.slice(-10);
    }

    // Return last 10 digits if longer than 10
    if (digits.length > 10) {
        return digits.slice(-10);
    }

    return digits;
}

export const sendNormalOTPMsg = async (number, content, purpose = null, otp, currentUrl) => {

  // console.log({
  //   number,content, purpose, otp, currentUrl
  // })

  if (!content || !number) return false;

  // console.log("original url",url);
  try {
    // Check BhashSMS balance
    const balanceRes = await axios.get('http://bhashsms.com/api/checkbalance.php', {
      params: {
        user: 'SkillsConnect',
        pass: 'Sc342eefyt46',
      }
    });

    // console.log("check 1");
    
    const balance = parseInt(balanceRes.data);
    // console.log(balance);
    
    // console.log("check 2");

    let response;
    console.log("check 3");
    if (balance <= 200) {
      await sendAlertMailToAdmin('bhashsms balance is low',
        `Hey there! It looks like your bhashsms balance is running low. Just a heads up, your available balance is ${balance}`,
        currentUrl
      );
      // console.log("check 4");
      
      response = await msg91SMS(number, otp);
      // console.log("response",response);
      
      await sendAlertMailToAdmin('bhashsms balance is low',
        `Hey there! It looks like your bhashsms balance is running low. Just a heads up, your available balance is ${balance}`,
        currentUrl
      );
      await sendAlertMailToAdmin('bhashsms balance is low',
        `Hey there! It looks like your bhashsms balance is running low. Just a heads up, your available balance is ${balance}`,
        currentUrl
      );

      // console.log('check 4');
      
    } else {  
      response = await bhashSMS(number, content);
      if (!response) {
        response = await msg91SMS(number, otp);
        await sendAlertMailToAdmin('SMS is sending via msg91sms',
          `Hey there! It looks like your bhashsms is failing. Please check it.\n${JSON.stringify(response)}
          `,currentUrl);
      }
    }

    if (response) {
      const now = new Date();
      // log insert 
      const logData = {
        template_entity:'user_otp',
        sent_to:number,
        purpose:purpose,
        whatsapp_body_parameters:content,
        sending_started:now,
        status:"sent",
        sending_completed:now,
        created_by:1,
        updated_by:1,
        created_on:now,
        updated_on:now,

      }
      await commonModel.insertData("ups_whatsapp_logs",logData);
      return true;
    } else {
      return false;
    }

  } catch (error) {
    // console.log("eRROR : ", error );
    console.error('OTP sending failed:', error.message);
    return false;
  }
};

export const generateOTP = async() =>{
  return Math.floor(1000 + Math.random() * 9000);
}

const sendAlertMailToAdmin = async (subject, emailBody, currentUrl, userId = 1) => {
  const emailFrom = 'support@skillsconnect.in';
  const emailTo = 'shivshankar.skillsconnect@gmail.com';
  // const emailCc = ['vinayak.skillsconnect@gmail.com'];
  const emailCc = "";

  const fullBody = `${emailBody} </br> URL: ${currentUrl}`

  // console.log("ADMIN DATA",{
  //   emailFrom,
  //   emailTo,
  //   emailCc,
  //   subject,
  //   mailBody: fullBody
  // });
  
  const mailData = {
    emailFrom,
    emailTo,
    emailCc,
    subject,
    mailBody: fullBody
  }

  const mailSent = await sendInstantMail(mailData)

  if(!mailSent){
    console.log("Error sending mail to admin");
    return false; 
  }

  return true;
  // const fullBody = `${emailBody}<br> URL : ${currentUrl}`;
  // let allowBuffer = false;

  // try {
  //   // Check if error buffer feature is available
  //   const [availableBufferRows] = await commonModel.getData("ups_system_error_logs","*","1=1");

  //   if (availableBufferRows.length > 0) {
  //     const [errorBuffer] = await db.execute(
  //       "SELECT id FROM ups_system_error_logs WHERE status IN ('Pending', 'Sent') AND subject = ? AND url = ? LIMIT 1",
  //       [subject, currentUrl]
  //     );

  //     if (errorBuffer.length === 0) {
  //       allowBuffer = true;
  //     }
  //   } else {
  //     const mailSent = await sendMail(emailFrom, emailTo, emailCc, subject, fullBody);
  //     const now = new Date();
  //     const emailData = {
  //       email_to: emailTo,
  //       email_from: emailFrom,
  //       email_cc: JSON.stringify(emailCc),
  //       purpose: 'Alert Mail to skillsconnect team',
  //       user_id: userId,
  //       subject,
  //       email_attachment: '',
  //       email_body: fullBody,
  //       created_on: now,
  //       created_by: 1,
  //       updated_on: now,
  //       updated_by: 1,
  //       status: mailSent ? 'Sent' : 'Pending',
  //       sending_started: now,
  //       sending_completed: now
  //     };

  //     const fields = Object.keys(emailData).join(', ');
  //     const placeholders = Object.keys(emailData).map(() => '?').join(', ');
  //     await db.execute(
  //       `INSERT INTO ups_email_logs (${fields}) VALUES (${placeholders})`,
  //       Object.values(emailData)
  //     );

  //     allowBuffer = true;
  //   }

  //   // Log to ups_system_error_logs if allowed
  //   if (allowBuffer) {
  //     const now = new Date();
  //     await db.execute(`
  //       INSERT INTO ups_system_error_logs 
  //       (status, body, url, subject, created_on, created_by, updated_on, updated_by) 
  //       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  //       ['Sent', fullBody, currentUrl, subject, now, 1, now, 1]
  //     );
  //   }

  // } catch (err) {
  //   console.error('Error in sendAlertMailToAdmin:', err.message);
  // }
};


export const getProfileCompletedStatus = async (userDetails) => {
  try {
    const user_id = userDetails.id;
    const frecord_id = userDetails.frecord_id;

    const condition = `id = '${frecord_id}'`;
    const getstudentBasicData = await commonModel.getData("ups_college_users", "id,email,resume,setup_percentage", condition);

    let completionStatusPercentage = 0;

    // check for basic details
    if (getstudentBasicData && getstudentBasicData.length > 0 && getstudentBasicData[0].email) {
      completionStatusPercentage += 20;
    }

    // check for resume
    if (getstudentBasicData && getstudentBasicData.length > 0 && getstudentBasicData[0].resume) {
      completionStatusPercentage += 10;
    }

    const videoCondition = `user_id = '${user_id}'`;
    const getstudentVideoData = await commonModel.getData("ups_student_video_interview", "about_yourself,organize_your_day,your_strength,taught_yourself_tately", videoCondition);

    // for about_yourself
    if (getstudentVideoData && getstudentVideoData.length > 0 && getstudentVideoData[0].about_yourself) {
      completionStatusPercentage += 2.5;
    }

    // for organize_your_day
    if (getstudentVideoData && getstudentVideoData.length > 0 && getstudentVideoData[0].organize_your_day) {
      completionStatusPercentage += 2.5;
    }

    // for your_strength
    if (getstudentVideoData && getstudentVideoData.length > 0 && getstudentVideoData[0].your_strength) {
      completionStatusPercentage += 2.5;
    }

    // for taught_yourself_tately
    if (getstudentVideoData && getstudentVideoData.length > 0 && getstudentVideoData[0].taught_yourself_tately) {
      completionStatusPercentage += 2.5;
    }

    const educationCondition = `user_id = '${user_id}'`;
    const getstudentEducationData = await commonModel.getData("ups_education_details", "degree_id", educationCondition);

    const basicEducationCondition = `user_id = '${user_id}'`;
    const getstudentBasicEducationData = await commonModel.getData("ups_basic_education_details", "board_type", basicEducationCondition);

    let hsc = true;
    if (getstudentEducationData && getstudentEducationData.length > 0) {
      let dr = true;
      let pg = true;
      for (const value of getstudentEducationData) {
        // for dr
        if (value.degree_id == 1) {
          if (dr) {
            completionStatusPercentage += 10;
            pg = false;
          }
        }
        // for pg
        if (value.degree_id == 2) {
          if (pg) {
            completionStatusPercentage += 10;
            dr = false;
          }
        }
        // for graduate
        if (value.degree_id == 3) {
          completionStatusPercentage += 10;
        }
        // for ug
        if (value.degree_id == 4) {
          completionStatusPercentage += 10;
          hsc = false;
        }
      }
    }

    if (getstudentBasicEducationData && getstudentBasicEducationData.length > 0) {
      for (const value of getstudentBasicEducationData) {
        // for hsc
        if (value.board_type == 5) {
          if (hsc) {
            completionStatusPercentage += 10;
          }
        }
        // for ssc
        if (value.board_type == 6) {
          completionStatusPercentage += 10;
        }
      }
    }

    // for project AND internship
    const projectCondition = `user_id = '${user_id}'`;
    const getstudentProjectInternshipData = await commonModel.getData("ups_user_project_internships", "type", projectCondition);

    if (getstudentProjectInternshipData && getstudentProjectInternshipData.length > 0) {
      const hasInternship = getstudentProjectInternshipData.some(item => item.type === 'Internship');
      const hasProject = getstudentProjectInternshipData.some(item => item.type === 'Project');

      if (hasInternship) {
        completionStatusPercentage += 2.5;
      }
      if (hasProject) {
        completionStatusPercentage += 2.5;
      }
    }

    // for work experience
    const workExperienceCondition = `user_id = '${user_id}'`;
    const getstudentWorkExperienceData = await commonModel.getData("ups_user_workexperience", "id", workExperienceCondition);

    if (getstudentWorkExperienceData && getstudentWorkExperienceData.length > 0 && getstudentWorkExperienceData[0].id) {
      completionStatusPercentage += 5;
    }

    // for languages
    const languageCondition = `user_id = '${user_id}'`;
    const getstudentLanguageData = await commonModel.getData("ups_users_languages", "id", languageCondition);

    if (getstudentLanguageData && getstudentLanguageData.length > 0 && getstudentLanguageData[0].id) {
      completionStatusPercentage += 5;
    }

    // for work skills
    const skillsCondition = `user_id = '${user_id}'`;
    const getstudentSkillsData = await commonModel.getData("ups_users_skills_achievements", "id", skillsCondition);

    if (getstudentSkillsData && getstudentSkillsData.length > 0 && getstudentSkillsData[0].id) {
      completionStatusPercentage += 5;
    }

    // update data into ups_college_users
    const updateCondition = `id = '${frecord_id}'`;
    const data = { setup_percentage: completionStatusPercentage };
    const res = await commonModel.updateData("ups_college_users", data, updateCondition);

    if (res) {
      return completionStatusPercentage;
    } else {
      return false;
    }
  } catch (error) {
    console.error('Error in getProfileCompletedStatus:', error);
    return false;
  }
};

export const getCandidateJobMatching = async (application_ids = [], job_id = null) => {
  try {
    if (!Array.isArray(application_ids) || !job_id) return false;

    // Step 1: Get job details
    const mainTable = ['ups_jobs as j', ['j.skills']];
    const joinTables = [
      ['LEFT', 'ups_jobs_qualification_criteria as ujqc', 'ujqc.job_id = j.id', ['GROUP_CONCAT(ujqc.course_id) as course_ids']]
    ];
    const condition = `j.id = ${job_id}`;
    const jobDetails = await commonModel.joinFetch(mainTable, joinTables, condition);
    
    if (!jobDetails || !jobDetails.length) return false;

    const job = jobDetails[0];
    const jobCourses = job.course_ids ? [...new Set(job.course_ids.split(',').map(c => c.trim()))] : [];
    const jobSkills = job.skills ? [...new Set(job.skills.split(',').map(s => slugify(s)))] : [];

    const totalCourses = jobCourses.length;
    const totalSkills = jobSkills.length;

    // Step 2: Loop through applications
    for (const applicationId of application_ids) {
      const mainUserTable = ['ups_job_applications as uja', []];
      const userJoins = [
        ['LEFT', 'ups_users_skills_achievements as uusa', 'uusa.user_id = uja.user_id', ['GROUP_CONCAT(uusa.skills) as skills']],
        ['LEFT', 'ups_education_details as ued', 'ued.user_id = uja.user_id', ['GROUP_CONCAT(ued.course_id) as course_ids']],
        ['LEFT', 'ups_users as u', 'u.id = uja.user_id', []],
        ['LEFT', 'ups_college_users as ucu', 'ucu.id = u.frecord_id', ['ucu.resume_parsed_json as json_data']]
      ];
      const userCondition = `uja.id = ${applicationId}`;
      const userResult = await commonModel.joinFetch(mainUserTable, userJoins, userCondition);

      if (!userResult || !userResult.length) continue;

      const user = userResult[0];

      // Step 3: Parse resume JSON and extract skills
      let userJsonSkills = [];
      if (user.json_data) {
        try {
          const parsed = JSON.parse(user.json_data);
          if (parsed.skills) {
            const skillsArray = Array.isArray(parsed.skills) ? parsed.skills : parsed.skills.split(',');
            userJsonSkills = skillsArray.map(skill => slugify(skill));
          }
        } catch (e) {
          console.error('Invalid JSON in resume_parsed_json');
        }
      }

      // Step 4: Combine all user skills
      const dbSkills = user.skills ? user.skills.split(',').map(s => slugify(s)) : [];
      const userSkills = [...new Set([...userJsonSkills, ...dbSkills])];

      // Step 5: Extract courses
      const userCourses = user.course_ids ? user.course_ids.split(',').map(c => c.trim()) : [];

      // Step 6: Calculate match %
      const matchedCourses = userCourses.filter(c => jobCourses.includes(c));
      const matchedSkills = userSkills.filter(s => jobSkills.includes(s));

      let coursePercentage = 0;
      if (totalCourses > 0) {
        coursePercentage = Math.min(30, Math.round((matchedCourses.length / totalCourses) * 30 * 100) / 100);
      }

      let skillPercentage = 0;
      if (totalSkills > 0) {
        skillPercentage = Math.min(70, Math.round((matchedSkills.length / totalSkills) * 70 * 100) / 100);
      }

      const totalPercentage = coursePercentage + skillPercentage;

      // Step 7: Update shortlist_percent in DB
      const updateData = { shortlist_percent: totalPercentage };
      const updated = await commonModel.updateData('ups_job_applications', updateData, `id = ${applicationId}`);
      if (!updated) {
        console.error(`Failed to update application ${applicationId}`);
      }
    }

    return true;
  } catch (err) {
    console.error('Error in getCandidateJobMatching:', err);
    return false;
  }
};

export const getCandidateJobMatchingAI = async (application_ids = [], job_id = null) => {
  try {
    if (!Array.isArray(application_ids) || !job_id) return false;

    /* ================================
       STEP 1: Fetch Job Details
    ================================= */

    const mainTable = ['ups_jobs as j', ['j.skills', 'j.job_description']];
    const joinTables = [
      [
        'LEFT',
        'ups_jobs_qualification_criteria as ujqc',
        'ujqc.job_id = j.id',
        []
      ],
      ['LEFT','ups_courses as c', "c.id = ujqc.course_id", ['GROUP_CONCAT(c.course_name) as course_ids']]
    ];

    const condition = `j.id = ${job_id}`;
    const jobDetails = await commonModel.joinFetch(mainTable, joinTables, condition);

    if (!jobDetails || !jobDetails.length) return false;

    const job = jobDetails[0];

    const jobDescription = job.job_description || '';
    const jobSkills = job.skills || '';
    const jobCourses = job.course_ids || '';

    const results = [];

    /* ================================
       STEP 2: Loop Through Candidates
    ================================= */

    for (const applicationId of application_ids) {

      const mainUserTable = ['ups_job_applications as uja', []];
      const userJoins = [
        [
          'LEFT',
          'ups_users_skills_achievements as uusa',
          'uusa.user_id = uja.user_id',
          ['GROUP_CONCAT(uusa.skills) as skills']
        ],
        [
          'LEFT',
          'ups_education_details as ued',
          'ued.user_id = uja.user_id',
          ['GROUP_CONCAT(ued.course_id) as course_ids']
        ],
        ['LEFT', 'ups_users as u', 'u.id = uja.user_id', []],
        [
          'LEFT',
          'ups_college_users as ucu',
          'ucu.id = u.frecord_id',
          ['ucu.resume_parsed_json as json_data']
        ]
      ];

      const userCondition = `uja.id = ${applicationId}`;
      const userResult = await commonModel.joinFetch(
        mainUserTable,
        userJoins,
        userCondition
      );

      if (!userResult || !userResult.length) continue;

      const user = userResult[0];

      /* ================================
         STEP 3: Prepare Student Profile
      ================================= */

      let resumeJson = {};
      if (user.json_data) {
        try {
          resumeJson = JSON.parse(user.json_data);
        } catch (err) {
          console.error('Invalid resume JSON');
        }
      }

      const studentProfile = {
        resumeData: resumeJson,
        dbSkills: user.skills || '',
        dbCourses: user.course_ids || ''
      };

      /* ================================
         STEP 4: Prepare AI Prompt
      ================================= */

      const systemPrompt = `
      You are an expert HR AI assistant.

      Your task is to evaluate a student's profile against a job description.

      Return ONLY a valid JSON object:

      {
        "matchPercentage": <number between 0 and 100>,
        "matchLevel": "<Excellent | High | Average | Poor>"
      }

      Criteria:
      - Excellent: 85% - 100%
      - High: 60% - 84%
      - Average: 40% - 59%
      - Poor: < 40%
      `;

            const userPrompt = `
      Job Description:
      ${jobDescription}

      Job Skills:
      ${jobSkills}

      Job Required Courses:
      ${jobCourses}

      Student Profile (JSON):
      ${JSON.stringify(studentProfile)}
      `;

      console.log('System Prompt:', systemPrompt);
      console.log('User Prompt:', userPrompt);
      const apiUrl = process.env.AZURE_OPENAI_URL || "https://skills-ai.openai.azure.com/openai/deployments/gpt-4o/chat/completions?api-version=2024-02-15-preview";
      const apiKey = process.env.AZURE_OPENAI_KEY || "3089c6a3603d4514ba45e52a50208de8";

      const response = await axios.post(
        apiUrl,
        {
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.3,
          max_tokens: 800
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'api-key': apiKey
          }
        }
      );

      const content = response?.data?.choices?.[0]?.message?.content;
      console.log('AI Response:', JSON.stringify(content));
      if (!content) continue;

      const cleaned = content.replace(/```json|```/g, '').trim();

      let parsed;
      try {
        parsed = JSON.parse(cleaned);
        if(parsed){
          console.log("matchPercentage:", JSON.stringify(parsed));
          const updateData = { shortlist_percent: parsed.matchPercentage };
          const updated = await commonModel.updateData('ups_job_applications', updateData, `id = ${applicationId}`);
          if (!updated) {
            console.error(`Failed to update application ${applicationId}`);
          }
        }
      } catch (err) {
        console.error('AI returned invalid JSON');
        continue;
      }

      results.push({
        application_id: applicationId,
        ...parsed
      });
    }

    return results;

  } catch (error) {
    console.error('Error in getCandidateJobMatchingAI:', error.message);
    return null;
  }
};
export const randomNumberGen = async (min, max) => {
  if (typeof min !== 'number' || typeof max !== 'number') {
    throw new Error('Both min and max must be numbers');
  }
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export const hasPermission = async(userDetails,permission) => {
   let hasPerm = false;
    if(!permission){
      return hasPerm; 
    }

    // console.log("userDetails in hasPermission function",userDetails.user_type);
    // return false;
    const userType = userDetails.user_type;
    // chehck user has permission or not
    let condition = `p.permission_slug = '${permission}' AND rpm.role_id = ${userType} AND p.is_deleted = 'No' AND p.status = 'Active' OR rpm.user_id = ${userDetails.id}  `;

    const main_table = ['ups_permissions as p', ['p.id','p.permission_name','p.permission_slug','p.module']];
    const join_table = [
      ['','ups_roles_permission_mapping as rpm','rpm.permission_id = p.id',['rpm.permission_id','rpm.role_id']],
    ]

    const result = await commonModel.joinFetch(main_table,join_table,condition);
    if(result && result.length > 0){
      hasPerm = true;
    }
    return hasPerm;
}



export const msg91SMS = async (phone, otp, { templateId = MSG91_TEMPLATE_ID, authKey = MSG91_AUTH_KEY } = {}) => {
  if (!phone || !otp) return false;
  // console.log("inside msg91" ,phone, otp);
  
  const url = 'https://control.msg91.com/api/v5/flow/';
  const payload = {
    template_id: templateId,
    short_url: '0',
    recipients: [
      {
        mobiles: `91${phone}`,
        var1: `${otp}`
      }
    ]
  };

  try {
    const resp = await axios.post(url, payload, {
      headers: {
        accept: 'application/json',
        authkey: authKey,
        'content-type': 'application/json'
      },
      timeout: 15000
    });

    // resp.data expected to be JSON similar to PHP response
    const data = resp?.data;
    if (data && data.type === 'success') {
      return data; // return parsed object on success
    }
    return false;
  } catch (err) {
    // optional: log error
    console.error('msg91SMS error:', err?.response?.data || err.message);
    return false;
  }
}


// bhashsms provider (GET)
export const bhashSMS = async (number, content, {
  userName = process.env.BHASH_USER || 'SkillsConnect',
  pass = process.env.BHASH_PASS || 'Sc342eefyt46',
  sender = process.env.BHASH_SENDER || 'SKILCO',
  priority = 'ndnd',
  type = 'normal'
} = {}) => {
  if (!number || !content) return false;

  // build url safely
  const base = 'https://bhashsms.com/api/sendmsg.php';
  const url = `${base}?user=${encodeURIComponent(userName)}&pass=${encodeURIComponent(pass)}&sender=${encodeURIComponent(sender)}&phone=${encodeURIComponent(number)}&text=${encodeURIComponent(content)}&priority=${encodeURIComponent(priority)}&stype=${encodeURIComponent(type)}`;

  try {
    const resp = await axios.get(url, { timeout: 15000 });
    if (resp && resp.status >= 200 && resp.status < 300) {
      // Return response data for inspection by caller (may be plain text)
      return resp.data;
    }
    return false;
  } catch (err) {
    console.error('bhashSMS error:', err?.response?.data || err.message);
    return false;
  }
}

export const getCollegeTpoEmails = async(college_id) => {
  if(!college_id){
    return false;
  }

  const condition = `cutm.master_college_id = '${college_id}'`;
  const mainTable = ['ups_college_users as cu', []];
  const joinTable = [
    ['','ups_users as u','u.frecord_id = cu.id',['u.full_name','u.email',"u.mobile",'u.first_name','u.last_name']],
    ['','ups_college_users_tpo_mapping as cutm',"cutm.user_id = u.id",["cutm.master_college_id"]],
    ['','ups_colleges as c','c.id = cutm.master_college_id',['c.college_name']]
  ]

  const getTpoEmails = await commonModel.joinFetch(mainTable,joinTable,condition);
  if(getTpoEmails && getTpoEmails.length > 0){
    
    return getTpoEmails;
  } else {
    return false;
  }

}

export const formatKolkataDateTime = async (d = new Date()) => {
    // get components in Asia/Kolkata
    const opts = { timeZone: 'Asia/Kolkata', hour12: false };
    const parts = new Intl.DateTimeFormat('en-GB', Object.assign({ year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }, opts))
        .formatToParts(d)
        .reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
    // parts day/month/year configured as dd/mm/yyyy
    const yyyy = parts.year;
    const mm = parts.month;
    const dd = parts.day;
    const hh = parts.hour;
    const min = parts.minute;
    const ss = parts.second;
    return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
};

export const convertDDMMYYYYToMySQL = (dateStr) => {
  if (!dateStr) return null;

  const [dd, mm, yyyy] = dateStr.split("-");
  if (!dd || !mm || !yyyy) return null;

  return `${yyyy}-${mm}-${dd} 00:00:00`;
};




// returns "D MMM YYYY" e.g. "5 Sep 2025" (no leading zero on day)
export const formatKolkataDateDisplay = async (d = new Date()) => {
    const opts = { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' };
    return new Intl.DateTimeFormat('en-GB', opts).format(d);
};

export const safeGet = async (arr, idx = 0, key = null) => {
    if (!arr || arr.length <= idx) return key ? undefined : {};
    return key ? arr[idx][key] : arr[idx];
};


export const updateCollegeRegisteredUserCore = async (collegeId = null) => {
  // When collegeId is provided, update that college; otherwise update all colleges with user_type 4
  const condition = collegeId
    ? `c.id = '${collegeId}' AND cu.user_type = '4'`
    : "cu.user_type = '4'";

  const mainTable = ['ups_colleges as c', ['c.college_name', 'c.id as college_id']];
  const joinTable = [
    ['left', 'ups_college_users as cu', 'cu.master_college_id = c.id', ['COUNT(cu.id) as total_student']],
  ];

  const result = await commonModel.joinFetch(mainTable, joinTable, condition);
  if (!result || result.length === 0) return false;

  let updated = false;
  for (const row of result) {
    const totalStudents = row.total_student || 0;
    const collegeIdToUpdate = row.college_id;
    const data = { overall_registration_received: totalStudents };
    const ok = await commonModel.updateData('ups_colleges', data, `id = '${collegeIdToUpdate}'`);
    if (ok) {
      updated = true;
    }
  }

  return updated;
};

// Update overall_cvs_received for jobs. If jobId provided, update that job; otherwise update all published jobs.
export const updateCvReceivedForJobsCore = async (jobId = null) => {
  const condition = jobId
    ? `1=1 AND j.id = '${jobId}'`
    : "1=1 AND j.job_status = 'Publish'";

  const mainTable = ['ups_jobs as j', ['j.id as job_id']];
  const joinTable = [
    ['', 'ups_job_applications as ja', 'ja.job_id = j.id', []],
    ['', 'ups_users as u', 'ja.user_id = u.id', ['COUNT(DISTINCT(u.id)) as totalcvsReceived']],
  ];

  const result = await commonModel.joinFetch(mainTable, joinTable, condition);
  if (!result || result.length === 0) return false;

  let updated = false;
  for (const row of result) {
    const totalCvs = row.totalcvsReceived || 0;
    const jobIdToUpdate = row.job_id;
    const data = { overall_cvs_received: totalCvs };
    const ok = await commonModel.updateData('ups_jobs', data, `id = '${jobIdToUpdate}'`);
    if (ok) {
      updated = true;
    }
  }

  return updated;
};

// export default {
//   encrypt,
//   decrypt,
//   decryptBase64,
//   slugify,
//   getEnum,
//   replaceApostrophe,
//   getTodayDateIST,

//   checkPackageExpireDate,
//   checkMailExist,
//   checkMobileExist,
//   checkWhatsappExist,
//   generateMD5Hash,
//   sanitizePhoneNumber,
//   sendNormalOTPMsg,
//   generateOTP,
//   getCandidateJobMatching,
//   randomNumberGen
// };

/**
 * Update package data - increments used count and decrements remaining count
 * @param {string} packageSlug - The package feature slug
 * @param {number} companyId - The company ID (optional if in session)
 * @param {object} session - The session object containing user data
 * @returns {Promise<boolean>} - Returns true if update successful, false otherwise
 */
export const updatePackageData = async (packageSlug, companyId = null) => {
  try {
    if (!packageSlug) {
      return false;
    }

    // Get company ID from session or parameter
    const finalCompanyId = companyId;
    
    if (!finalCompanyId) {
      return false;
    }

    // Build the JOIN query
    const condition = `pufm.package_feature_slug = '${packageSlug}' AND pufm.company_id = '${finalCompanyId}' AND pufm.status = 'Active'`;
    
    const mainTable = ["ups_package_user_mapping as pum", ["pum.*"]];
    
    const joinTables = [
      [
        "", 
        "ups_packages_user_feature_mapping as pufm", 
        "pufm.package_user_mapping_id = pum.id", 
        [
          "pufm.package_features_total_number",
          "pufm.package_features_used_number",
          "pufm.package_features_remaining_number",
          "pufm.package_feature_id",
          "pufm.id as package_user_feature_mapping_id"
        ]
      ]
    ];

    // Execute JOIN query
    const result = await commonModel.joinFetch(mainTable, joinTables, condition, "", "");
    
    if (!result || result.length === 0) {
      return false;
    }

    // Get payment ID
    const paymentData = await commonModel.getData(
      "ups_package_user_mapping",
      "payment_id",
      `company_id='${finalCompanyId}'`
    );

    if (!paymentData || paymentData.length === 0) {
      return false;
    }

    const paymentId = paymentData[0].payment_id;

    // Check if package has remaining usage
    if (result[0].package_features_total_number > result[0].package_features_used_number) {
      // Prepare update data
      const totalUsedData = {
        payment_id: paymentId,
        package_features_used_number: result[0].package_features_used_number + 1,
        package_features_remaining_number: result[0].package_features_remaining_number - 1
      };

      // Update the feature mapping
      const conditionUpdate = `company_id = '${finalCompanyId}' AND package_feature_slug = '${packageSlug}' AND id = '${result[0].package_user_feature_mapping_id}'`;
      const updateSuccess = await commonModel.updateData(
        'ups_packages_user_feature_mapping',
        totalUsedData,
        conditionUpdate
      );

      if (!updateSuccess) {
        return false;
      }

      // Prepare log data
      const logData = {
        ...totalUsedData,
        user_id: session?.skillsconnect_admin?.[0]?.id,
        created_by: session?.skillsconnect_admin?.[0]?.id,
        company_id: finalCompanyId,
        package_id: result[0].package_id,
        package_validity_id: result[0].package_validity_id,
        package_feature_id: result[0].package_feature_id,
        package_features_used_number: result[0].package_features_used_number ,
        package_features_remaining_number: result[0].package_features_remaining_number
      };

      // Insert log entry
      const resultInsertLog = await commonModel.insertData(
        'ups_packages_user_feature_mapping_log',
        logData
      );

      return resultInsertLog ? true : false;
    } else {
      // No remaining package features
      return false;
    }
  } catch (error) {
    console.error('Error in updatePackageData:', error);
    return false;
  }
};

export const maskEmailAndMobile = (email, mobile) => {
  const result = {
    maskedEmail: email || '',
    maskedMobile: mobile || ''
  };
  
  if (email && email.includes('@')) {
    const atIndex = email.indexOf('@');
    const username = email.substring(0, atIndex);
    const domain = email.substring(atIndex);
    
    const usernameLength = username.length;
    const maskHalf = Math.ceil(usernameLength / 2);
    const keepVisible = usernameLength - maskHalf;
    
    const visible = username.substring(0, keepVisible);
    const masked = 'x'.repeat(maskHalf);
    result.maskedEmail = visible + masked + domain;
  }
  
  if (mobile) {
    const clean = mobile.replace(/\D/g, '');
    if (clean.length > 3) {
      const lastThree = clean.slice(-3);
      const masked = 'x'.repeat(clean.length - 3);
      result.maskedMobile = masked + lastThree;
    }
  }
  
  return result;
};

export const hasPackageLimit = async (userDetails,packageSlug, company_id = null) => {
  // console.log("COMPANY ID IN HAS PACKAGE LIMIT",company_id);
  try {
    // Check if session exists and user type is valid
    // if (!session || !session.skillsconnect_admin || !session.skillsconnect_admin[0]) {
    //   return false;
    // }


    // Check if user type is in allowed arrays
    if (
      ['7', '8', '16'].includes(String(userDetails.user_type)) ||
      (['1', '2', '3'].includes(String(userDetails.user_type)) && company_id)
    ) {
      let hasPackage = false;
      const today = new Date().toISOString().split('T')[0]; // Format: YYYY-MM-DD
      const companyIdToUse = userDetails.company_id || company_id;

      // Build query condition
      const condition = `pum.status = 'Active' AND pum.is_deleted = 'No' AND pufm.status = 'Active' AND pufm.is_deleted = 'No' AND pufm.package_feature_slug = '${packageSlug}' AND start_date <= '${today}' AND end_date >= '${today}' AND pum.company_id = '${companyIdToUse}'`;

      const main_table = ['ups_package_user_mapping as pum', ['pum.*']];
      const join_tables = [
        ['', 'ups_packages_user_feature_mapping as pufm', 'pufm.package_user_mapping_id = pum.id', ['pufm.*']]
      ];

      // Fetch package details from database
      const packageDetails = await commonModel.joinFetch(
        main_table,
        join_tables,
        condition,
        { 'pufm.id': 'DESC' },
        'pufm.package_feature_slug'
      );

      // console.log("PACKAGE DETAILS IN HAS PACKAGE LIMIT",packageDetails);
      // return false;
      // const packageDetails = await commonModel.MySqlFetchRow(rs, 'array');

      if (packageDetails && packageDetails.length > 0) {
        hasPackage = true;

        if (packageDetails[0].package_features_total_number) {
          const usedNumber = packageDetails[0].package_features_used_number || 0;
          const totalNumber = packageDetails[0].package_features_total_number;

          if (usedNumber >= totalNumber) {
            hasPackage = false;
            return {status: hasPackage, message: 'Package limit reached. Please upgrade to continue'};
          } else {
            return {status: hasPackage, message: 'You still have package usage left.'};
          }
        }
      } else {
        hasPackage = false;
        return {status: hasPackage, message: 'No active package found. Please purchase a package to continue.'};
      }

      // if (returnUrl) {
      //   return hasPackage;
      // } else {
      //   if (!hasPackage) {
      //     return {
      //       success: false,
      //       message: 'Your package has been expired!',
      //       redirectTo: '/dashboard'
      //     };
      //   }
      // }
    }
  } catch (error) {
    console.error('Error in hasPackageLimit:', error);
    return false;
  }
};
