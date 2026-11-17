<?php


header('Content-Type: text/html; charset=utf-8');
defined('BASEPATH') or exit('No direct script access allowed');

class Process extends AdminController
{
    public function __construct()
    {
        parent::__construct();
        $this->load->model('process_model', "process", TRUE);
        $this->load->library('form_validation');
    }

    public function process($id = "")
    {

        $data = array();
        if ($this->input->post()) {
            // echo "<pre>",
            // print_r($_POST);die;
            // echo current_url();die;
            $this->form_validation->set_rules('process-name', 'Process Name', 'required');
            if ($_POST['email']) {

                $this->form_validation->set_rules('email_content', 'Email Content', 'required');
                if ($this->form_validation->run() == FALSE) {

                    set_alert('danger', _l('email_content_required', _l('process')));
                    redirect(current_url(), 'refresh');
                }
            }
            if ($_POST['whatsapp']) {

                $this->form_validation->set_rules('whatsapp_content', 'WhatsApp Content', 'required');
                if ($this->form_validation->run() == FALSE) {

                    set_alert('danger', _l('whatsapp_content_required', _l('process')));
                    redirect(current_url(), 'refresh');
                }
            }
            // $this->form_validation->set_rules('whatsapp_content', 'WhatsApp Content', 'required');
            $data = array();
            $communication_mode = "";
            if (!empty($_POST['email'])) {
                $communication_mode .= 'email';
            }
            if (!empty($_POST['whatsapp'])) {
                $communication_mode .= (!empty($_POST['email']) ? "," : "") . 'whatsapp';
            }
            $checkProcessName = $this->process->getProcessName(trim($_POST['process-name']), $id);
            // echo $this->db->last_query();die;
            if (empty($communication_mode)) {
                // echo $communication_mode;die;
                set_alert('danger', _l('communication_mode_required', _l('process')));
                redirect(current_url(), 'refresh');
            }
            if ($this->form_validation->run() == FALSE) {
                set_alert('danger', _l('form_validation', _l('process')));
                redirect(current_url(), 'refresh');
            } else {

                if ($checkProcessName) {

                    set_alert('danger', _l('process_exist', _l('process')));
                    redirect(current_url(), 'refresh');
                } else {

                    $data['process_name']       =   trim($this->input->post('process-name'));
                    $data['email_subject']      =   trim($this->input->post('email_subject'));
                    $data['email_content']      =   trim(str_replace("%7B%7D", "{}", $this->input->post('email_content',false)));
                    $data['whatsapp_content']   =   trim($this->input->post('whatsapp_content',false));
                    $data['communication_mode'] =   trim($communication_mode);
                    $data['status']             =   $this->input->post("status");;
                    if ($id) {


                        $data['updated_on']         =   date('Y-m-d H:i:s');
                        $data['updated_by']         =   date('Y-m-d H:i:s');
                        $result = $this->process->updateData($data, $id);
                        if ($result) {
                            set_alert('success', _l('process_updated', _l('process')));
                            redirect($_SESSION['_prev_url'], 'refresh');
                        } else {
                            set_alert('danger', _l('something_went_wrong', _l('process')));
                        }
                    } else {

                        $data['created_by']         =   date('Y-m-d H:i:s');
                        $data['created_on']         =   date('Y-m-d H:i:s');
                        $result = $this->process->insertData($data);
                        if ($result) {
                            set_alert('success', _l('process_added', _l('process')));
                            redirect($_SESSION['_prev_url'], 'refresh');
                        } else {
                            set_alert('danger', _l('something_went_wrong', _l('process')));
                        }
                    }
                }
            }
        }
        if ($id) {
            $data['process'] = $this->process->getProcessDetails($id);
            $communicationModes = explode(',', $data['process']['communication_mode']);
            $data['whatsapp'] = in_array('whatsapp', $communicationModes) ? true : false;

            $data['email'] = in_array('email', $communicationModes) ? true : false;
            // echo print_r($whatsapp);die;
        }
        // echo "<pre>",
        // print_r( $data);die;
        $this->load->view("admin/process/index", $data);
    }

    public function index()
    {

        $this->load->view("admin/process/manage");
    }

    public function table()
    {

        if ($this->input->is_ajax_request()) {
            // echo "hello";die;
            $this->app->get_table_data('process');
        }
        // App_table::find('process')->output();
    }


    // public function processDetails($master_process_id="",$lead_id = ''){

    //     $data = [];
    //     $title = "Process Details";
    //     $data['processMaster'] = $this->process->getProcessDetails($master_process_id);
    //     $data['process'] = $this->process->getStafProcessDetails($_SESSION['staff_user_id'],$master_process_id);
    //     $process_id = $data['process']['id'];
    //     $communication_modes = array();
    //     if(isset($data['process']['communication_mode'])){

    //         $communicationModes = explode(',', $data['process']['communication_mode']);
    //     }
    //     $data['whatsapp'] = in_array('whatsapp', $communicationModes) ? true : false;

    //     $data['email'] = in_array('email', $communicationModes) ? true : false;
    //     if($this->input->post()){

    //         $this->form_validation->set_rules('process-name', 'Process Name', 'required');
    //         if($_POST['email']){

    //             $this->form_validation->set_rules('email_content', 'Email Content', 'required');
    //             if($this->form_validation->run() == FALSE){
    //                 echo json_encode(array("status"=>false, "msg"=> _l('email_content_required', _l('process'))));
    //                 exit;

    //             }
    //         }
    //         if($_POST['whatsapp']){

    //             $this->form_validation->set_rules('whatsapp_content', 'WhatsApp Content', 'required');
    //             if($this->form_validation->run() == FALSE){
    //                 echo json_encode(array("status"=>false, "msg"=> _l('whatsapp_content_required', _l('process'))));
    //                 exit;

    //             }
    //         }
    //         // $this->form_validation->set_rules('whatsapp_content', 'WhatsApp Content', 'required');
    //         $data = array();
    //         $communication_mode = "";
    //         if(!empty($_POST['email'])){
    //             $communication_mode .= 'email';
    //         }
    //         if(!empty($_POST['whatsapp'])){
    //             $communication_mode .= (!empty($_POST['email']) ? "," :"").'whatsapp';

    //         }
    //         $checkProcessName = $this->process->getProcessName(trim($_POST['process-name']),$process_id,$_SESSION['staff_user_id']);
    //         // get masterProcessid
    //         $master_process_id = 
    //         // echo $this->db->last_query();die;
    //         if(empty($communication_mode)){
    //             // echo $communication_mode;die;
    //             echo json_encode(array("status"=>false, "msg"=> _l('communication_mode_required', _l('process'))));
    //             exit;

    //         }
    //         if ($this->form_validation->run() == FALSE){
    //             echo json_encode(array("status"=>false, "msg"=> _l('form_validation', _l('process'))));
    //             exit;

    //         }else{

    //             if($checkProcessName){
    //                 echo json_encode(array("status"=>false, "msg"=> "Process already exists"));
    //                 exit;

    //             }else{

    //                 $data['process_name']       =   trim($this->input->post('process-name'));
    //                 $data['email_content']      =   trim($this->input->post('email_content'));
    //                 $data['whatsapp_content']   =   trim($this->input->post('whatsapp_content'));
    //                 $data['communication_mode'] =   trim($communication_mode);
    //                 $data['status']             =   "Active";
    //                 $data['staff_id']           =   $_SESSION['staff_user_id'];
    //                 $data['master_process_id']  =   "";
    //                 if($process_id){



    //                     $data['updated_on']         =   date('Y-m-d H:i:s');
    //                     $data['updated_by']         =   date('Y-m-d H:i:s');
    //                     $result = $this->process->updateData($data,$process_id);
    //                     if($result){
    //                         echo json_encode(array("status"=>true, "msg"=> "Process updated successfully"));
    //                         exit;
    //                         // set_alert('success', _l('process_updated', _l('process')));
    //                     }else{
    //                         echo json_encode(array("status"=>false, "msg"=> "Oops! something went wrong"));
    //                         exit;
    //                     }
    //                 }else{


    //                     $data['created_by']         =   date('Y-m-d H:i:s');
    //                     $data['created_on']         =   date('Y-m-d H:i:s');
    //                     $result = $this->process->insertData($data);
    //                     if($result){
    //                         echo json_encode(array("status"=>true, "msg"=> "Process added successfully"));
    //                         exit;
    //                         // set_alert('success', _l('process_added', _l('process')));

    //                     }else{
    //                         echo json_encode(array("status"=>false, "msg"=> "Oops! something went wrong"));
    //                         exit;
    //                         // set_alert('danger', _l('something_went_wrong', _l('process')));
    //                     }
    //                 }


    //             }
    //         }


    //     }
    //         // echo print_r($whatsapp);die;

    //     $data['id']      = $process_id;
    //     $data['title']   = $title;
    //     $this->load->view('admin/process/process', $data);
    // }

    public function processDetails($master_process_id = "", $lead_id = "", $disable = "")
    {
        $this->load->model('leads_model');
        $master_process_id =  (!empty($master_process_id) ? $master_process_id :  $_POST['master_process_id']);
        $data = [];
        $data['title'] = "Process Details";
        $staff_id = $_SESSION['staff_user_id'];
        $data['disabled'] = $disable;
        $highestProcess = $this->process->checkMailStatusLower($lead_id);
        // if($highestProcess['process_id'] >= $master_process_id){
        //     $data['disabled'] = "1";
        // }
        // echo "<pre>",
        // print_r($highestPRocess);die;
        // Fetch master and staff-specific process details
        $data['originlData'] = $this->process->getProcessDetails($master_process_id);
        $data['processMaster'] = $this->process->getProcessDetails($master_process_id);
        $data['process'] = $this->process->getStafProcessDetails($staff_id, $master_process_id, $_POST['lead_id']);
        // echo $this->db->last_query();die;
        if (!empty($data['process'])) {
            $data['processMaster'] = $data['process'];
        }
        // echo $this->db->last_query();die;
        // Populate communication modes
        $communication_modes = isset($data['process']['communication_mode'])
            ? explode(',', $data['process']['communication_mode'])
            : [];
        $data['whatsapp'] = in_array('whatsapp', $communication_modes);
        $data['email'] = in_array('email', $communication_modes);

        if ($this->input->post()) {
            // Validation rules
            $this->form_validation->set_rules('process-name', 'Process Name', 'required');
            if (!empty($_POST['email'])) {
                $this->form_validation->set_rules('email_content', 'Email Content', 'required');
            }
            // if (!empty($_POST['whatsapp'])) {
            //     $this->form_validation->set_rules('whatsapp_content', 'WhatsApp Content', 'required');
            // }

            if ($this->form_validation->run() == FALSE) {
                echo json_encode([
                    "status" => false,
                    "msg" => validation_errors(),
                ]);
                exit;
            }

            // get master process id 
            $master_process_id =  $this->process->getProcessId(trim($this->input->post('process-name')));
            // print_r($master_process_id);die;
            // Prepare data for insertion/updation
            $data_to_save = [
                'process_name' => trim($this->input->post('process-name')),
                'email_content' => trim(str_replace("%7B%7D", "{}", $this->input->post('email_content',false))),
                'email_subject' =>  $_POST['email_subject'] ? $_POST['email_subject'] : $master_process_id['email_subject'],
                'whatsapp_content' => $master_process_id['whatsapp_content'],
                'whatsapp_template_name' => $master_process_id['whatsapp_template_name'],
                'communication_mode' => implode(',', array_filter([
                    !empty($_POST['email']) ? 'email' : '',
                    !empty($_POST['whatsapp']) ? 'whatsapp' : '',
                ])),
                'status' => 'Active',
                'staff_id' => $staff_id,
                'master_process_id' => $master_process_id['id'],
            ];

            if (empty($data_to_save['communication_mode'])) {
                echo json_encode([
                    "status" => false,
                    "msg" => "At least one communication mode must be selected.",
                ]);
                exit;
            }

            if (!empty($data['process'])) {
                // echo "in";die;
                // Update staff-specific process
                $data_to_save['updated_on'] = date('Y-m-d H:i:s');
                $data_to_save['updated_by'] = $staff_id;
                $result = $this->process->updateData($data_to_save, $data['process']['id']);
            } else {
                // echo "out";die;
                // Insert new staff-specific process
                $data_to_save['lead_id'] = $_POST['lead_id'];
                $data_to_save['contact_date_time'] = (!empty($_POST['contact_date_time']) ? date("Y-m-d H:i:s", strtotime($_POST['contact_date_time'])) : date("Y-m-d H:i:s"));
                $data_to_save['created_on'] = date('Y-m-d H:i:s');
                $data_to_save['created_by'] = $staff_id;
                $result = $this->process->insertData($data_to_save);
            }

            if ($result) {
                // $dataLeads["lead_id"] = $_POST['lead_id'];
                // $dataLeads['process_id'] = $master_process_id['id'];
                // $dataLeads['created_on'] = date("Y-m-d H:i:s");
                // $dataLeads['created_by'] = $staff_id;
                // $dataLeads['contact_date_time'] = date("Y-m-d H:i:s",strtotime($_POST['contact_date_time']));
                // // echo "<pre>",
                // // print_r($dataLeads);die;
                // $insertToSales = $this->leads_model->insertSales($dataLeads);
                echo json_encode([
                    "status" => true,
                    // "msg" => "Mail Scheduled Successfully",
                    "msg" => !empty($data['process']) ? "Mail Scheduled Successfully." : "Mail Schedule Updated Successfully.",
                ]);
            } else {
                echo json_encode([
                    "status" => false,
                    "msg" => "An error occurred. Please try again.",
                ]);
            }
            exit;
        }
        $data['lead_id'] = $lead_id;
        $data['master_process_id'] = $master_process_id;
        // Load view with data
        $this->load->view('admin/process/process', $data);
    }

    public function delete($lead_id)
    {
        if (!empty($lead_id)) {

            $deleteData = $this->process->deleteProcess($lead_id);
            if ($deleteData) {
                set_alert('danger', _l('process_delete', _l('process')));
                redirect($_SESSION['_prev_url']);
            }
        } else {
            set_alert('danger', _l('something_went_wrong', _l('process')));
            redirect($_SESSION['prev_url']);
        }
    }
}
