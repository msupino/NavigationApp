using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;
using UnityEngine.Events;
using TMPro;

public enum ParamType
{
    Standard,
    Bool,
    Enum
}

public struct Param
{
    public string name;
    public ParamType type;
    public UnityAction<string> callback;
    public UnityAction<bool> boolCallback;
    public UnityAction<int> intCallback;
    public GameObject inputGroup;
    public TMP_InputField inputField;
    public TMP_Dropdown comboInputField;
    public Toggle boolInputField;
    public string intialValue;
    public int intInitialValue;
    public bool intialBoolValue;
    public List<string> enumOptions;
}

public class Inspector : MonoBehaviour
{
    public GameObject selected;
    public TextMeshProUGUI header;
    public GameObject inpugGroup;
    public GameObject boolInputGroup;
    public GameObject comboInputGroup;
    public GameObject clearButton;
    public GameObject icon;

    private bool enterEdit = false;
    
    private List<Param> parameters = new List<Param>();
    // Start is called before the first frame update
    void Start()
    {
        Clear();
        clearButton.GetComponent<Button>().onClick.AddListener(Clear);
    }

    // Update is called once per frame
    void Update()
    {
        
    }

    private void Clear()
    {
        for (int i=0;i<parameters.Count;i++)
        {
            Destroy(parameters[i].inputGroup);
            // parameters.RemoveAt(i);
        }
        parameters = new List<Param>();
        header.text = "";
        clearButton.SetActive(false);
        icon.SetActive(false);
        selected = null;
        
        if (!enterEdit) 
        {
            gameObject.SetActive(false); 
        }
    }


    public void Edit(GameObject GO, string name, List<Param> _parameters)
    {
        enterEdit = true;
        Clear();
        enterEdit = false;

        gameObject.SetActive(true);
        clearButton.SetActive(true);
        icon.SetActive(true);
        selected = GO;
        header.text = name; 
        for (int i = 0; i < _parameters.Count; i++)
        {   
            Param p = _parameters[i];
            switch (p.type)
            {
                case ParamType.Standard:
                    p.inputGroup = Instantiate(inpugGroup, Vector3.zero, Quaternion.identity);
                    p.inputGroup.transform.SetParent(gameObject.transform);           
                    p.inputGroup.transform.GetChild(1).GetComponent<TextMeshProUGUI>().text = p.name;
                    p.inputField = p.inputGroup.transform.GetChild(2).GetComponent<TMP_InputField>();
                    p.inputField.text = p.intialValue;
                    p.inputField.onEndEdit.AddListener(p.callback);
                    break;
                case ParamType.Bool:
                    p.inputGroup = Instantiate(boolInputGroup, Vector3.zero, Quaternion.identity);
                    p.inputGroup.transform.SetParent(gameObject.transform);           
                    p.boolInputField = p.inputGroup.transform.GetChild(2).GetComponent<Toggle>();
                    p.boolInputField.isOn = p.intialBoolValue;
                    p.boolInputField.onValueChanged.AddListener(p.boolCallback);
                    break;
                case ParamType.Enum:
                    p.inputGroup = Instantiate(comboInputGroup, Vector3.zero, Quaternion.identity);
                    p.inputGroup.transform.SetParent(gameObject.transform);           
                    p.comboInputField = p.inputGroup.transform.GetChild(2).GetComponent<TMP_Dropdown>();
                    p.comboInputField.options.Clear();
                    for (int y=0; y<p.enumOptions.Count;y++)
                    {
                        p.comboInputField.options.Add(new TMP_Dropdown.OptionData(p.enumOptions[y]));
                    }
                    p.comboInputField.value = p.intInitialValue;
                    p.comboInputField.onValueChanged.AddListener(p.intCallback);
                    break;
            }
            p.inputGroup.transform.GetChild(1).GetComponent<TextMeshProUGUI>().text = p.name;
            parameters.Add(p);
        }      
    }
}
