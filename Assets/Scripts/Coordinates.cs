using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using CoordinateSharp;


[ExecuteInEditMode]
public class Coordinates : MonoBehaviour
{

    public LineRenderer the_renderer;

    private float height;
    //private float height2;
    private float width;


    // Start is called before the first frame update
    void Start()
    {
        Coordinate bottom_left = new Coordinate(33.0, 35.00);
        Coordinate top_left = new Coordinate(33.16666667, 35.00); //== 33 10 00 N 35 00 00 E
        //Coordinate top_left_2 = new Coordinate(33.20, 35.0);
        //Coordinate top_right = new Coordinate(33.0, 35.0);
        Coordinate bottom_right = new Coordinate(33.00, 35.16666667); //== 33 00 00 N 35 10 00 E


        height = Convert.ToSingle(new Distance(bottom_left, top_left).NauticalMiles);
        print(height);
        //height2 = Convert.ToSingle(new Distance(bottom_left, top_left_2).NauticalMiles);
        //print(height2);
        width = Convert.ToSingle(new Distance(bottom_left, bottom_right).NauticalMiles);
        print(width);

        the_renderer.positionCount = 6;

        //bottom left
        the_renderer.SetPosition(0, Vector3.zero);

        //top left
        the_renderer.SetPosition(1, new Vector3(0, 0, height));

        //top right
        the_renderer.SetPosition(2, new Vector3(width, 0, height));

        //bottom right
        the_renderer.SetPosition(3, new Vector3(width, 0, 0));

        //bottom left
        the_renderer.SetPosition(4, Vector3.zero);

        //top left2
        //the_renderer.SetPosition(5, new Vector3(0, 0, height2));
    }

    // Update is called once per frame
    void Update()
    {

        //the_renderer.positionCount = 5;

        ////bottom left
        //the_renderer.SetPosition(0, Vector3.zero); 

        ////top left
        //the_renderer.SetPosition(1, new Vector3(0,0, height));

        ////top right
        //the_renderer.SetPosition(2, new Vector3(width, 0, height));

        ////bottom right
        //the_renderer.SetPosition(3, new Vector3(width, 0, 0));

        ////bottom left
        //the_renderer.SetPosition(4, Vector3.zero);



        //get the total distance to the top
        //var height = new Distance(bottom_left, top_left).Meters;
        //print(height);

        //the_renderer.SetPosition(1, new Vector3((float)height, 0f, 0f));
        //the_renderer.SetPosition(2, new Vector3(1f, 0f, 1f));
    }
}
