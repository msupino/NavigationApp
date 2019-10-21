using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;
using UnityEngine.Events;
using TMPro;

public enum ParamType
{
    Standard,
    Bool
}

public struct Param
{
    public string name;
    public ParamType type;
    public UnityAction<string> callback;
    public UnityAction<bool> boolCallback;
    public GameObject inputGroup;
    public TMP_InputField inputField;
    public Toggle boolInputField;
    public string intialValue;
    public bool intialBoolValue;
}

public class Inspector : MonoBehaviour
{
    public GameObject selected;
    public TextMeshProUGUI header;
    public GameObject inpugGroup;
    public GameObject boolInputGroup;
    public GameObject clearButton;
    
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
        selected = null;

    }


    public void Edit(GameObject GO, string name, List<Param> _parameters)
    {
        Clear();
        clearButton.SetActive(true);
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
            }
            p.inputGroup.transform.GetChild(1).GetComponent<TextMeshProUGUI>().text = p.name;
            parameters.Add(p);
        }      
    }
}
